/* =========================================================
   EXCELSO — CALENDAR, REMINDERS & REGULAR-TASK SCHEDULES  —  v9.1
   Loaded after script.js. Pairs with Schedule.gs.

   - Calendar page: month view + day list with due dates,
     follow-ups, regular tasks (from their schedule) and reminders.
   - Reminders: add / edit / delete, optional repeat, optional
     WhatsApp ping.
   - Regular tasks: a real schedule (every Monday, 7th of the month,
     30th, 7th & 21st, …) and a time, with "Today / Coming up" on top.

   Every date and time here is India time (IST), even if the
   computer is set to another time zone.
========================================================= */

const IST_TZ = "Asia/Kolkata";
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let calSchedules = {};        // regularTaskId -> { schedule, time }
let calReminders = [];
let calDefaultTime = "16:00";
let calLoaded = false;
let calLoading = false;
let calLoadedAt = 0;
let calMonth = "";            // yyyy-mm-01 of the month on screen
let calSelected = "";         // yyyy-mm-dd
const calFilters = { due: true, followup: true, regular: true, reminder: true };

let reminderOwnerPicker = null;
let reminderSchedulePicker = null;
let regularSchedulePicker = null;

/* =========================================================
   IST HELPERS
========================================================= */

const istFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function istNow() {
    const p = {};
    istFormatter.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { ymd: p.year + "-" + p.month + "-" + p.day, hm: p.hour + ":" + p.minute };
}

function ymdUtc(ymd) {
    const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function utcYmd(date) { return date.toISOString().slice(0, 10); }

function addDaysYmd(ymd, n) {
    const d = ymdUtc(ymd);
    d.setUTCDate(d.getUTCDate() + n);
    return utcYmd(d);
}

function minutesOf(hm) {
    const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

function time12(hm) {
    const mins = minutesOf(hm);
    if (mins < 0) return "";
    const h = Math.floor(mins / 60), m = mins % 60;
    return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM");
}

function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function dayTitle(ymd) {
    const d = ymdUtc(ymd);
    return DOW_SHORT[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3);
}

/* =========================================================
   SCHEDULES (same rules as Schedule.gs)
   daily | weekdays | weekly:mon,thu | monthly:7,21 | monthly:last
========================================================= */

function parseSchedule(value) {
    const s = String(value || "").trim().toLowerCase();
    if (!s || s === "none") return null;
    if (s === "daily") return { type: "daily" };
    if (s === "weekdays") return { type: "weekdays" };
    let m = s.match(/^weekly:([a-z,\s]+)$/);
    if (m) {
        const days = m[1].split(",").map(function (x) { return DOW_KEYS.indexOf(x.trim().slice(0, 3)); }).filter(function (i) { return i >= 0; });
        return days.length ? { type: "weekly", days: days } : null;
    }
    m = s.match(/^monthly:([0-9a-z,\s]+)$/);
    if (m) {
        const dates = m[1].split(",").map(function (x) { x = x.trim(); return x === "last" ? "last" : parseInt(x, 10); })
            .filter(function (x) { return x === "last" || (x >= 1 && x <= 31); });
        return dates.length ? { type: "monthly", dates: dates } : null;
    }
    return null;
}

function scheduleOccursOn(value, ymd) {
    const p = typeof value === "object" && value ? value : parseSchedule(value);
    const d = ymdUtc(ymd);
    if (!p || !d) return false;
    const dow = d.getUTCDay();
    if (p.type === "daily") return true;
    if (p.type === "weekdays") return dow !== 0;
    if (p.type === "weekly") return p.days.indexOf(dow) !== -1;
    if (p.type === "monthly") {
        const date = d.getUTCDate();
        const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        return p.dates.some(function (x) { return x === "last" || x > lastDay ? date === lastDay : date === x; });
    }
    return false;
}

/* The label also feeds the old "Expected Time" column, so the
   Daily / Weekly / Monthly groups on the Regular Tasks page keep working. */
function scheduleLabel(value) {
    const p = parseSchedule(value);
    if (!p) return "";
    if (p.type === "daily") return "Daily";
    if (p.type === "weekdays") return "Daily (Mon–Sat)";
    if (p.type === "weekly") {
        const names = p.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).map(function (i) { return DOW_SHORT[i]; });
        return (names.length === 2 ? "Twice weekly" : "Weekly") + " (" + names.join(", ") + ")";
    }
    const dates = p.dates.slice().sort(function (a, b) { return (a === "last" ? 99 : a) - (b === "last" ? 99 : b); })
        .map(function (x) { return x === "last" ? "last day" : ordinal(x); });
    return (dates.length === 2 ? "Twice monthly" : "Monthly") + " (" + dates.join(", ") + ")";
}

function regularSchedule(task) {
    const info = calSchedules[String(task.regularTaskId)];
    if (info && info.schedule) return info.schedule;
    return /daily|every\s*day|everyday/i.test(String(task.expectedTime || "")) ? "daily" : "";
}

function regularTime(task) {
    return (calSchedules[String(task.regularTaskId)] || {}).time || "";
}

function reminderOccursOn(r, ymd) {
    if (!r.date || ymd < r.date) return false;
    if (!r.repeat || r.repeat === "none") return r.date === ymd;
    return scheduleOccursOn(r.repeat, ymd);
}

function loggedOn(regularTaskId, ymd) {
    const latest = regularLatest[String(regularTaskId)];
    return !!latest && String(latest.date || "") === ymd;
}

/* =========================================================
   DATA
========================================================= */

async function loadCalendarData(options = {}) {

    if (calLoading || !currentUser) return;
    calLoading = true;

    const result = await apiRequest("getCalendarData", {}, { silent: true });
    calLoading = false;

    if (!result || !result.success) {
        if (!options.silent && currentPage === "calendar") showNotification("Calendar not updated", result?.message || "Couldn't load reminders.");
        return;
    }

    calSchedules = result.schedules || {};
    calReminders = result.reminders || [];
    calDefaultTime = result.defaultRegularTime || "16:00";
    calLoaded = true;
    calLoadedAt = Date.now();

    if (currentPage === "calendar" || currentPage === "regularTasks") renderCurrentPage();

}

/* Called by script.js after every data refresh. */
function onCoreDataLoaded(options) {
    const stale = Date.now() - calLoadedAt > 5 * 60 * 1000;
    if (!calLoaded || stale || !options.silent || currentPage === "calendar" || currentPage === "regularTasks") {
        loadCalendarData({ silent: true });
    }
}

function resetCalendarState() {
    calSchedules = {};
    calReminders = [];
    calLoaded = false;
    calLoadedAt = 0;
    calMonth = "";
    calSelected = "";
}

/* =========================================================
   WHAT HAPPENS ON A DAY
========================================================= */

function isMineReminder(r) {
    return currentUserMatches(r.assignedTo) || normalizePersonName(r.createdBy) === normalizePersonName(currentUserLabel());
}

function calendarRegularList() {
    return showEveryone ? regularTasks : regularTasks.filter(function (r) { return currentUserMatches(r.assignedTo); });
}

function calendarReminderList() {
    return showEveryone ? calReminders : calReminders.filter(isMineReminder);
}

/* All items on one date, timed ones first in time order. */
function itemsOn(ymd, taskList, regularList, reminderList) {

    const now = istNow();
    const items = [];

    if (calFilters.due || calFilters.followup) {
        taskList.forEach(function (t) {
            if (t.status === "Completed") return;
            if (calFilters.due && t.dueDate === ymd) {
                items.push({ kind: "due", id: t.taskId, title: t.task, owners: t.assignedTo, time: "",
                    meta: t.department, overdue: ymd < now.ymd, priority: t.priority });
            }
            if (calFilters.followup && t.followupDate === ymd) {
                items.push({ kind: "followup", id: t.taskId, title: t.task, owners: t.assignedTo, time: "",
                    meta: t.lastAction ? "Last: " + t.lastAction : t.department });
            }
        });
    }

    if (calFilters.regular) {
        regularList.forEach(function (r) {
            if (!scheduleOccursOn(regularSchedule(r), ymd)) return;
            const time = regularTime(r);
            let state = "";
            if (ymd === now.ymd) {
                if (loggedOn(r.regularTaskId, ymd)) state = "done";
                else if (minutesOf(time || calDefaultTime) <= minutesOf(now.hm)) state = "late";
            }
            items.push({ kind: "regular", id: r.regularTaskId, title: r.task, owners: r.assignedTo, time: time,
                meta: scheduleLabel(regularSchedule(r)), state: state });
        });
    }

    if (calFilters.reminder) {
        reminderList.forEach(function (r) {
            if (!reminderOccursOn(r, ymd)) return;
            items.push({ kind: "reminder", id: r.reminderId, title: r.title, owners: r.assignedTo, time: r.time,
                meta: (r.repeat && r.repeat !== "none" ? scheduleLabel(r.repeat) : "") + (r.notes ? (r.repeat !== "none" ? " — " : "") + r.notes : ""),
                state: r.status === "Done" ? "done" : "", whatsapp: r.whatsapp });
        });
    }

    return items.sort(function (a, b) {
        const ta = a.time ? minutesOf(a.time) : 9999, tb = b.time ? minutesOf(b.time) : 9999;
        return ta - tb || a.kind.localeCompare(b.kind);
    });

}

/* =========================================================
   CALENDAR PAGE
========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    reminderOwnerPicker = createOwnerPicker(document.getElementById("reminderOwnerPicker"));
    if (reminderOwnerPicker) extraOwnerPickers.push(reminderOwnerPicker);
    reminderSchedulePicker = createSchedulePicker(document.getElementById("reminderSchedulePicker"), { allowNone: true });
    regularSchedulePicker = createSchedulePicker(document.getElementById("regularTaskSchedulePicker"), { allowNone: false });

    document.getElementById("calPrev")?.addEventListener("click", function () { shiftCalendarMonth(-1); });
    document.getElementById("calNext")?.addEventListener("click", function () { shiftCalendarMonth(1); });
    document.getElementById("calToday")?.addEventListener("click", function () {
        const today = istNow().ymd;
        calMonth = today.slice(0, 8) + "01";
        calSelected = today;
        renderCalendar();
    });

    document.getElementById("calFilters")?.addEventListener("change", function (event) {
        const key = event.target.dataset.filter;
        if (!key) return;
        calFilters[key] = event.target.checked;
        event.target.closest(".cal-filter")?.classList.toggle("is-on", event.target.checked);
        renderCalendar();
    });

    document.getElementById("calGrid")?.addEventListener("click", function (event) {
        const pill = event.target.closest("[data-open-kind]");
        if (pill && !window.matchMedia("(max-width: 700px)").matches) {
            event.stopPropagation();
            openCalendarItem(pill.dataset.openKind, pill.dataset.openId);
            return;
        }
        const cell = event.target.closest("[data-date]");
        if (!cell) return;
        calSelected = cell.dataset.date;
        if (calSelected.slice(0, 7) !== calMonth.slice(0, 7)) calMonth = calSelected.slice(0, 8) + "01";
        renderCalendar();
        if (window.matchMedia("(max-width: 900px)").matches) document.getElementById("calDayPanel")?.scrollIntoView({ block: "start" });
    });

    document.getElementById("calDayList")?.addEventListener("click", function (event) {
        const item = event.target.closest("[data-open-kind]");
        if (item) openCalendarItem(item.dataset.openKind, item.dataset.openId);
    });

    document.getElementById("calendarAddReminder")?.addEventListener("click", function () { openReminderModal(null, calSelected || istNow().ymd); });
    document.getElementById("calAddForDay")?.addEventListener("click", function () { openReminderModal(null, calSelected || istNow().ymd); });

    // Reminder modal
    document.getElementById("reminderForm")?.addEventListener("submit", function (event) { event.preventDefault(); saveReminderFromModal(); });
    document.getElementById("reminderDeleteButton")?.addEventListener("click", deleteReminderFromModal);
    const modal = document.getElementById("reminderModal");
    modal?.addEventListener("click", function (event) {
        if (event.target === modal || event.target.closest("[data-close-reminder]")) closeReminderModal();
    });

});

function shiftCalendarMonth(step) {
    const d = ymdUtc(calMonth || istNow().ymd.slice(0, 8) + "01");
    d.setUTCMonth(d.getUTCMonth() + step, 1);
    calMonth = utcYmd(d);
    calSelected = calSelected && calSelected.slice(0, 7) === calMonth.slice(0, 7) ? calSelected : calMonth;
    renderCalendar();
}

function renderCalendar() {

    const grid = document.getElementById("calGrid");
    if (!grid) return;

    const today = istNow().ymd;
    if (!calMonth) calMonth = today.slice(0, 8) + "01";
    if (!calSelected) calSelected = today;

    const first = ymdUtc(calMonth);
    setText("calMonthTitle", MONTHS[first.getUTCMonth()] + " " + first.getUTCFullYear());

    const taskList = scopedTasks();
    const regularList = calendarRegularList();
    const reminderList = calendarReminderList();

    // Monday-first grid, 6 rows
    const offset = (first.getUTCDay() + 6) % 7;
    const start = addDaysYmd(calMonth, -offset);
    const month = calMonth.slice(0, 7);
    let html = "";

    for (let i = 0; i < 42; i++) {
        const ymd = addDaysYmd(start, i);
        const items = itemsOn(ymd, taskList, regularList, reminderList);
        const classes = ["cal-cell"];
        if (ymd.slice(0, 7) !== month) classes.push("is-outside");
        if (ymd === today) classes.push("is-today");
        if (ymd === calSelected) classes.push("is-selected");
        if (items.some(function (x) { return x.kind === "due" && x.overdue; })) classes.push("has-overdue");

        const shown = items.slice(0, 3).map(function (x) {
            return `<button type="button" class="cal-pill cal-${x.kind}${x.state ? " is-" + x.state : ""}${x.overdue ? " is-overdue" : ""}" data-open-kind="${x.kind}" data-open-id="${escapeHtml(x.id)}" title="${escapeHtml(x.title)}">
                ${x.time ? `<span class="cal-pill-time">${escapeHtml(time12(x.time).replace(":00", ""))}</span>` : ""}${escapeHtml(x.title)}</button>`;
        }).join("");

        const dots = items.slice(0, 4).map(function (x) { return `<i class="cal-dot cal-${x.kind}"></i>`; }).join("");

        html += `
            <div class="${classes.join(" ")}" data-date="${ymd}" role="button" tabindex="0" aria-label="${escapeHtml(dayTitle(ymd))}, ${items.length} item${items.length === 1 ? "" : "s"}">
                <span class="cal-date">${Number(ymd.slice(8))}</span>
                <div class="cal-pills">${shown}${items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : ""}</div>
                <div class="cal-dots">${dots}</div>
            </div>`;
    }

    grid.innerHTML = html;
    renderCalendarDay(calSelected, taskList, regularList, reminderList);

    const loading = document.getElementById("calLoadingNote");
    if (loading) loading.hidden = calLoaded;

}

function renderCalendarDay(ymd, taskList, regularList, reminderList) {

    const now = istNow();
    const items = itemsOn(ymd, taskList, regularList, reminderList);
    const d = ymdUtc(ymd);

    setText("calDayTitle", ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()] + ", " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]);
    setText("calDaySub", ymd === now.ymd ? "Today, now " + time12(now.hm) + " IST" : ymd === addDaysYmd(now.ymd, 1) ? "Tomorrow" : "");

    const list = document.getElementById("calDayList");
    if (!list) return;

    if (!items.length) {
        list.innerHTML = `<div class="cal-empty">Nothing scheduled. Add a reminder for this day if you need one.</div>`;
        return;
    }

    const kindName = { due: "Due", followup: "Follow-up", regular: "Regular", reminder: "Reminder" };

    list.innerHTML = items.map(function (x) {
        let status = "";
        if (x.kind === "regular" && x.state === "done") status = `<span class="cal-status is-done">Logged</span>`;
        else if (x.kind === "regular" && x.state === "late") status = `<span class="cal-status is-late">Not logged yet</span>`;
        else if (x.kind === "due" && x.overdue) status = `<span class="cal-status is-late">Overdue</span>`;
        else if (x.kind === "reminder" && x.state === "done") status = `<span class="cal-status is-done">Done</span>`;

        return `
            <button type="button" class="cal-item cal-${x.kind}${x.state === "done" ? " is-done" : ""}" data-open-kind="${x.kind}" data-open-id="${escapeHtml(x.id)}">
                <span class="cal-item-time">${x.time ? escapeHtml(time12(x.time)) : (x.kind === "regular" ? "Any time" : "All day")}</span>
                <span class="cal-item-body">
                    <span class="cal-item-kind">${kindName[x.kind]} ${escapeHtml(x.id)}${x.whatsapp ? " · WhatsApp" : ""}</span>
                    <strong>${escapeHtml(x.title)}</strong>
                    ${x.meta ? `<span class="cal-item-meta">${escapeHtml(x.meta)}</span>` : ""}
                    ${x.owners ? `<span class="cal-item-owners">${ownersDisplay(x.owners)}</span>` : ""}
                </span>
                ${status}
            </button>`;
    }).join("");

}

function openCalendarItem(kind, id) {
    if (kind === "due" || kind === "followup") return openTaskDetailDrawer(id);
    if (kind === "regular") return openRegularTaskUpdate(id);
    if (kind === "reminder") {
        const r = calReminders.find(function (x) { return x.reminderId === id; });
        if (r) openReminderModal(r);
    }
}

/* =========================================================
   SCHEDULE PICKER (regular tasks and repeating reminders)
========================================================= */

function createSchedulePicker(root, options = {}) {

    if (!root) return null;

    const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
    root.innerHTML = `
        <select class="schedule-type" aria-label="Repeats">
            ${options.allowNone ? `<option value="none">Does not repeat</option>` : ""}
            <option value="daily">Every day</option>
            <option value="weekdays">Every working day (Mon–Sat)</option>
            <option value="weekly">On chosen weekdays</option>
            <option value="monthly">On dates of the month</option>
        </select>
        <div class="schedule-days" data-show="weekly">
            ${weekdayOrder.map(function (i) {
                return `<label class="chip-check"><input type="checkbox" value="${DOW_KEYS[i]}"><span>${DOW_SHORT[i]}</span></label>`;
            }).join("")}
        </div>
        <div class="schedule-dates" data-show="monthly">
            ${Array.from({ length: 31 }, function (_, i) {
                return `<label class="chip-check"><input type="checkbox" value="${i + 1}"><span>${i + 1}</span></label>`;
            }).join("")}
            <label class="chip-check schedule-last"><input type="checkbox" value="last"><span>Last day</span></label>
        </div>
        <p class="schedule-summary"></p>
    `;

    const type = root.querySelector(".schedule-type");
    const summary = root.querySelector(".schedule-summary");

    function sync() {
        root.querySelectorAll("[data-show]").forEach(function (el) { el.hidden = el.dataset.show !== type.value; });
        root.querySelectorAll(".chip-check").forEach(function (chip) { chip.classList.toggle("is-on", chip.querySelector("input").checked); });
        const value = api.getValue();
        let text = value && value !== "none" ? "Repeats: " + scheduleLabel(value) + "." : "";
        if (type.value === "weekly" && !value) text = "Tick at least one day.";
        if (type.value === "monthly" && !value) text = "Tick at least one date.";
        if (type.value === "monthly" && /\b(29|30|31)\b/.test(value)) text += " In shorter months it falls on the last day.";
        summary.textContent = text;
    }

    const api = {
        getValue: function () {
            if (type.value === "none" || type.value === "daily" || type.value === "weekdays") return type.value;
            const box = root.querySelector(type.value === "weekly" ? ".schedule-days" : ".schedule-dates");
            const picked = Array.from(box.querySelectorAll("input:checked")).map(function (i) { return i.value; });
            return picked.length ? type.value + ":" + picked.join(",") : "";
        },
        setValue: function (value) {
            const p = parseSchedule(value);
            root.querySelectorAll("input[type='checkbox']").forEach(function (i) { i.checked = false; });
            if (!p) type.value = options.allowNone ? "none" : "weekly";
            else {
                type.value = p.type;
                if (p.type === "weekly") p.days.forEach(function (d) { const i = root.querySelector(`.schedule-days input[value="${DOW_KEYS[d]}"]`); if (i) i.checked = true; });
                if (p.type === "monthly") p.dates.forEach(function (d) { const i = root.querySelector(`.schedule-dates input[value="${d}"]`); if (i) i.checked = true; });
            }
            sync();
        },
        root: root
    };

    type.addEventListener("change", sync);
    root.addEventListener("change", function (event) { if (event.target.type === "checkbox") sync(); });

    api.setValue(options.allowNone ? "none" : "");
    return api;

}

/* =========================================================
   REMINDER MODAL
========================================================= */

let editingReminder = null;

function canEditReminder(r) {
    return !r || isPrivilegedUser() || normalizePersonName(r.createdBy) === normalizePersonName(currentUserLabel());
}

function openReminderModal(reminder, date) {

    closeAllOverlays();
    editingReminder = reminder || null;
    const editable = canEditReminder(reminder);

    setText("reminderModalTitle", reminder ? (editable ? "Edit reminder" : "Reminder") : "Add reminder");
    setInput("reminderTitle", reminder ? reminder.title : "");
    setInput("reminderDate", reminder ? reminder.date : (date || istNow().ymd));
    setInput("reminderTime", reminder ? reminder.time : "");
    setInput("reminderNotes", reminder ? reminder.notes : "");
    reminderSchedulePicker?.setValue(reminder ? reminder.repeat : "none");
    reminderOwnerPicker?.setValue(reminder ? reminder.assignedTo : (currentUser?.name || currentUser?.username || ""));
    reminderOwnerPicker?.setDisabled(!editable || !isPrivilegedUser());

    const wa = document.getElementById("reminderWhatsApp");
    if (wa) wa.checked = !!(reminder && reminder.whatsapp);
    const done = document.getElementById("reminderDone");
    if (done) done.checked = !!(reminder && reminder.status === "Done");
    const doneGroup = document.getElementById("reminderDoneGroup");
    if (doneGroup) doneGroup.hidden = !reminder;

    document.querySelectorAll("#reminderForm input, #reminderForm textarea, #reminderForm select").forEach(function (el) { el.disabled = !editable; });
    const save = document.getElementById("reminderSaveButton");
    if (save) save.style.display = editable ? "" : "none";
    const del = document.getElementById("reminderDeleteButton");
    if (del) del.style.display = reminder && editable ? "" : "none";

    setText("reminderMeta", reminder ? "Added by " + (reminder.createdBy || "someone") + (reminder.createdDate ? " on " + displayDate(reminder.createdDate) : "") : "");
    showFormError("reminderFormError", "");

    document.getElementById("reminderModal").style.display = "flex";
    document.body.classList.add("modal-open");
    if (!window.matchMedia("(pointer: coarse)").matches) setTimeout(function () { document.getElementById("reminderTitle")?.focus(); }, 50);

}

function closeReminderModal() {
    const modal = document.getElementById("reminderModal");
    if (!modal || modal.style.display === "none") return;
    modal.style.display = "none";
    reminderOwnerPicker?.close();
    const anyOpen = document.querySelector(".modal-overlay[style*='flex'], .detail-drawer[style*='block'], .regular-task-update-modal[style*='flex']");
    if (!anyOpen) document.body.classList.remove("modal-open");
    editingReminder = null;
}

async function saveReminderFromModal() {

    const repeat = reminderSchedulePicker ? reminderSchedulePicker.getValue() : "none";
    const payload = {
        reminderId: editingReminder ? editingReminder.reminderId : "",
        title: getInput("reminderTitle").trim(),
        date: getInput("reminderDate"),
        time: getInput("reminderTime"),
        repeat: repeat || "",
        assignedTo: reminderOwnerPicker ? reminderOwnerPicker.getValue() : "",
        notes: getInput("reminderNotes").trim(),
        whatsapp: !!document.getElementById("reminderWhatsApp")?.checked,
        status: document.getElementById("reminderDone")?.checked ? "Done" : "Active"
    };

    if (!payload.title) return showFormError("reminderFormError", "Give the reminder a title.");
    if (!payload.date) return showFormError("reminderFormError", "Pick a date.");
    if (!repeat) return showFormError("reminderFormError", "Pick the days it repeats on.");
    if (payload.whatsapp && !payload.time) return showFormError("reminderFormError", "Add a time so WhatsApp knows when to send it.");
    showFormError("reminderFormError", "");

    const button = document.getElementById("reminderSaveButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("reminderSave", async function () { result = await apiRequest("saveReminder", payload); });
    setButtonLoading(button, false);

    if (!result || !result.success) return showFormError("reminderFormError", result?.message || "Couldn't save the reminder.");

    const saved = result.reminder;
    if (saved) {
        const i = calReminders.findIndex(function (r) { return r.reminderId === saved.reminderId; });
        if (i !== -1) calReminders[i] = saved; else calReminders.push(saved);
        calSelected = saved.date;
        calMonth = saved.date.slice(0, 8) + "01";
    }

    closeReminderModal();
    renderCurrentPage();
    showNotification("Saved", "Reminder saved for " + dayTitle(payload.date) + (payload.time ? ", " + time12(payload.time) + " IST" : "") + ".");

}

async function deleteReminderFromModal() {

    if (!editingReminder) return;
    const r = editingReminder;
    if (!confirm("Delete the reminder \u201c" + r.title + "\u201d?" + (r.repeat !== "none" ? "\n\nIt repeats, so every future occurrence goes too." : ""))) return;

    let result = null;
    await guardAsync("reminderDelete", async function () { result = await apiRequest("deleteReminder", { reminderId: r.reminderId }); });
    if (!result || !result.success) return showFormError("reminderFormError", result?.message || "Couldn't delete it.");

    calReminders = calReminders.filter(function (x) { return x.reminderId !== r.reminderId; });
    closeReminderModal();
    renderCurrentPage();
    showNotification("Deleted", "Reminder deleted.");

}

/* =========================================================
   REGULAR TASKS — schedule line on cards + "Today / Coming up"
========================================================= */

function regularScheduleLine(regularTaskId) {
    const task = findRegularTask(regularTaskId);
    if (!task) return "";
    const schedule = regularSchedule(task);
    const time = regularTime(task);
    if (!schedule) {
        return isPrivilegedUser() && calLoaded ? `<span class="regular-task-schedule is-missing">No schedule set: press Edit to choose days and a time</span>` : "";
    }
    return `<span class="regular-task-schedule">${escapeHtml(scheduleLabel(schedule))}${time ? ", " + escapeHtml(time12(time)) + " IST" : ""}</span>`;
}

function regularUpcomingHtml() {

    if (!calLoaded) return "";

    const now = istNow();
    const list = calendarRegularList();
    const today = list.filter(function (r) { return scheduleOccursOn(regularSchedule(r), now.ymd); })
        .sort(function (a, b) { return (minutesOf(regularTime(a)) + 10000) % 10000 - (minutesOf(regularTime(b)) + 10000) % 10000; });

    const upcoming = [];
    for (let i = 1; i <= 7 && upcoming.length < 12; i++) {
        const ymd = addDaysYmd(now.ymd, i);
        list.forEach(function (r) {
            if (upcoming.length < 12 && scheduleOccursOn(regularSchedule(r), ymd)) upcoming.push({ ymd: ymd, task: r });
        });
    }

    const unscheduled = isPrivilegedUser() ? list.filter(function (r) { return !regularSchedule(r); }).length : 0;
    if (!today.length && !upcoming.length && !unscheduled) return "";

    const todayRows = today.map(function (r) {
        const time = regularTime(r);
        const done = loggedOn(r.regularTaskId, now.ymd);
        const late = !done && minutesOf(time || calDefaultTime) <= minutesOf(now.hm);
        return `
            <div class="upnext-row${done ? " is-done" : late ? " is-late" : ""}">
                <span class="upnext-time">${time ? escapeHtml(time12(time)) : "Any time"}</span>
                <span class="upnext-main"><strong>${escapeHtml(r.task)}</strong><span>${escapeHtml(r.regularTaskId)}${r.department ? ", " + escapeHtml(r.department) : ""}</span></span>
                <span class="upnext-owners">${ownersDisplay(r.assignedTo)}</span>
                ${done ? `<span class="cal-status is-done">Logged</span>`
                    : `<button type="button" class="regular-task-update-button" data-regular-task-id="${escapeHtml(r.regularTaskId)}">${late ? "Log now" : "Log update"}</button>`}
            </div>`;
    }).join("");

    const upcomingRows = upcoming.map(function (u) {
        const time = regularTime(u.task);
        return `<div class="upnext-mini"><span>${escapeHtml(dayTitle(u.ymd))}${time ? ", " + escapeHtml(time12(time)) : ""}</span><strong>${escapeHtml(u.task.task)}</strong></div>`;
    }).join("");

    return `
        <div class="panel regular-upnext">
            <div class="regular-upnext-today">
                <div class="upnext-head"><h3>Today, ${escapeHtml(dayTitle(now.ymd))}</h3><span>${today.length ? today.filter(function (r) { return loggedOn(r.regularTaskId, now.ymd); }).length + " of " + today.length + " logged" : "Nothing scheduled today"}</span></div>
                ${todayRows || `<p class="upnext-empty">No regular tasks are scheduled for today${showEveryone ? "" : " for you"}.</p>`}
            </div>
            <div class="regular-upnext-later">
                <div class="upnext-head"><h3>Coming up</h3><span>Next 7 days</span></div>
                ${upcomingRows || `<p class="upnext-empty">Nothing in the next 7 days.</p>`}
                ${unscheduled ? `<p class="upnext-warning">${unscheduled} regular task${unscheduled === 1 ? " has" : "s have"} no schedule yet, so ${unscheduled === 1 ? "it doesn't" : "they don't"} show here or in the calendar. Press Edit on ${unscheduled === 1 ? "it" : "them"} to choose days and a time.</p>` : ""}
            </div>
        </div>`;

}
