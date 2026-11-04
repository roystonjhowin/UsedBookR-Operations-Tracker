/* =========================================================
   EXCELSO — WHATSAPP REMINDERS (admin panel)  —  v9.1
   Lives on the Team & Departments page. Founder / Operations Head.
   Pairs with Schedule.gs.

   - Test / Live switch (Test only writes to the WhatsApp Log sheet)
   - Message times and on/off switches
   - Each person's WhatsApp number and on/off switch
   - "Send test to me", "Preview today's messages", recent log
========================================================= */

let waState = null;        // { settings, connected, contacts, log }
let waLoading = false;

const WA_TYPE_NAMES = { summary: "Morning summary", regular: "Regular-task reminder", overdue: "Overdue nudge", reminder: "Calendar reminder" };

document.addEventListener("DOMContentLoaded", function () {

    document.getElementById("waSaveSettings")?.addEventListener("click", saveWhatsAppSettings);
    document.getElementById("waTestButton")?.addEventListener("click", sendWhatsAppTest);
    document.getElementById("waPreviewButton")?.addEventListener("click", previewWhatsAppToday);

    const contacts = document.getElementById("waContacts");
    contacts?.addEventListener("input", function (event) {
        const row = event.target.closest(".wa-contact");
        if (row) row.querySelector(".wa-contact-save").disabled = false;
    });
    contacts?.addEventListener("change", function (event) {
        const row = event.target.closest(".wa-contact");
        if (event.target.classList.contains("wa-type")) event.target.closest(".chip-check")?.classList.toggle("is-on", event.target.checked);
        if (row) row.querySelector(".wa-contact-save").disabled = false;
    });
    contacts?.addEventListener("click", function (event) {
        const button = event.target.closest(".wa-contact-save");
        if (button) saveWhatsAppContact(button.closest(".wa-contact"));
    });

});

function resetWhatsAppState() { waState = null; }

async function renderWhatsAppPanel(force) {

    if (!isPrivilegedUser()) return;
    if (waState && !force) return paintWhatsAppPanel();
    if (waLoading) return;

    waLoading = true;
    const result = await apiRequest("getWhatsAppSettings", {}, { silent: true });
    waLoading = false;

    if (!result || !result.success) {
        const box = document.getElementById("waContacts");
        if (box) box.innerHTML = `<div class="empty-state">${escapeHtml(result?.message || "Couldn't load the WhatsApp settings. Check that Schedule.gs is added and deployed.")}</div>`;
        return;
    }

    waState = result;
    paintWhatsAppPanel();

}

function paintWhatsAppPanel() {

    if (!waState) return;
    const s = waState.settings || {};

    const live = s.mode === "live";
    const badge = document.getElementById("waModeBadge");
    if (badge) {
        badge.textContent = live ? "Live: sending" : "Test mode: log only";
        badge.classList.toggle("is-live", live);
    }

    document.querySelectorAll("input[name='waMode']").forEach(function (r) { r.checked = r.value === (live ? "live" : "test"); });
    const liveRadio = document.querySelector("input[name='waMode'][value='live']");
    if (liveRadio) liveRadio.disabled = !waState.connected;

    setText("waConnection", waState.connected
        ? "Connected to BusinessOnBot."
        : "BusinessOnBot isn't connected yet, so only Test mode is available. Messages are written to the WhatsApp Log sheet so you can check the wording.");

    setInput("waMorningTime", s.morningTime);
    setInput("waRegularTime", s.regularTime);
    setInput("waOverdueTime", s.overdueTime);
    [["waSummaryOn", "summaryOn"], ["waRegularOn", "regularOn"], ["waOverdueOn", "overdueOn"], ["waReminderOn", "reminderOn"]].forEach(function (pair) {
        const box = document.getElementById(pair[0]);
        if (box) box.checked = s[pair[1]] !== false;
    });

    paintWhatsAppContacts();
    paintWhatsAppLog();

}

function formatPhone(number) {
    const d = String(number || "");
    if (d.length === 12 && d.indexOf("91") === 0) return "+91 " + d.slice(2, 7) + " " + d.slice(7);
    return d ? "+" + d : "";
}

function paintWhatsAppContacts() {

    const box = document.getElementById("waContacts");
    if (!box || !waState) return;

    const people = (waState.contacts || []).filter(function (c) { return c.active; });
    if (!people.length) { box.innerHTML = `<div class="empty-state">No active team members.</div>`; return; }

    const short = { summary: "Morning summary", regular: "Regular reminders", overdue: "Overdue nudge", reminder: "Calendar reminders" };
    const today = typeof istNow === "function" ? istNow().ymd : "";

    box.innerHTML = people.map(function (c) {
        const skip = c.skip || [];
        const paused = c.pauseUntil && today && today <= c.pauseUntil;
        return `
            <div class="wa-contact${c.alerts ? "" : " is-off"}" data-username="${escapeHtml(c.username)}">
                <span class="wa-contact-name">${escapeHtml(c.name)}</span>
                <input type="tel" class="wa-contact-number" value="${escapeHtml(formatPhone(c.number))}" placeholder="+91 98450 12345" aria-label="WhatsApp number for ${escapeHtml(c.name)}" inputmode="tel" autocomplete="off">
                <label class="switch" title="Send WhatsApp reminders to ${escapeHtml(c.name)}">
                    <input type="checkbox" class="wa-contact-alerts" ${c.alerts ? "checked" : ""}>
                    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
                    <span class="sr-only">Reminders on</span>
                </label>
                <button type="button" class="secondary-button wa-contact-save" disabled>Save</button>
                <div class="wa-contact-types" role="group" aria-label="Messages ${escapeHtml(c.name)} gets">
                    ${Object.keys(short).map(function (t) {
                        const on = skip.indexOf(t) === -1;
                        return `<label class="chip-check${on ? " is-on" : ""}"><input type="checkbox" class="wa-type" value="${t}" ${on ? "checked" : ""}><span>${short[t]}</span></label>`;
                    }).join("")}
                    <label class="wa-pause">Pause until <input type="date" class="wa-contact-pause" value="${escapeHtml(c.pauseUntil || "")}" aria-label="Pause ${escapeHtml(c.name)}'s messages until"></label>
                    ${paused ? `<span class="wa-status is-test">Paused till ${escapeHtml(displayDate(c.pauseUntil))}</span>` : ""}
                </div>
            </div>`;
    }).join("");

}

function paintWhatsAppLog() {

    const box = document.getElementById("waLog");
    if (!box || !waState) return;
    const log = (waState.log || []).slice(0, 25);

    if (!log.length) {
        box.innerHTML = `<div class="empty-state">No messages yet. The first ones appear after the next scheduled time, or press "Send test to me".</div>`;
        return;
    }

    box.innerHTML = log.map(function (m) {
        const tone = /^sent/i.test(m.status) ? "is-sent" : /^failed/i.test(m.status) ? "is-failed" : /^test/i.test(m.status) ? "is-test" : "is-skipped";
        return `
            <div class="wa-log-row">
                <div class="wa-log-head">
                    <strong>${escapeHtml(m.to)}</strong>
                    <span>${escapeHtml(WA_TYPE_NAMES[m.type] || m.type)}, ${escapeHtml(m.timestamp)}</span>
                    <span class="wa-status ${tone}">${escapeHtml(m.status)}</span>
                </div>
                <p>${escapeHtml(m.message)}</p>
                ${m.detail && tone === "is-failed" ? `<small>${escapeHtml(m.detail)}</small>` : ""}
            </div>`;
    }).join("");

}

async function saveWhatsAppSettings() {

    const mode = document.querySelector("input[name='waMode']:checked")?.value || "test";
    if (mode === "live" && waState?.settings?.mode !== "live" &&
        !confirm("Switch to Live?\n\nReal WhatsApp messages will go to everyone with a number and reminders switched on.")) return;

    const payload = {
        mode: mode,
        morningTime: getInput("waMorningTime"),
        regularTime: getInput("waRegularTime"),
        overdueTime: getInput("waOverdueTime"),
        summaryOn: !!document.getElementById("waSummaryOn")?.checked,
        regularOn: !!document.getElementById("waRegularOn")?.checked,
        overdueOn: !!document.getElementById("waOverdueOn")?.checked,
        reminderOn: !!document.getElementById("waReminderOn")?.checked
    };

    const button = document.getElementById("waSaveSettings");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("waSettings", async function () { result = await apiRequest("saveWhatsAppSettings", payload); });
    setButtonLoading(button, false);

    if (!result || !result.success) return showNotification("Not saved", result?.message || "Couldn't save the WhatsApp settings.");

    waState.settings = result.settings;
    waState.connected = result.connected;
    paintWhatsAppPanel();
    showNotification("Saved", result.settings.mode === "live" ? "WhatsApp reminders are live." : "Settings saved. Still in test mode.");

}

async function saveWhatsAppContact(row) {

    if (!row) return;
    const button = row.querySelector(".wa-contact-save");
    const payload = {
        username: row.dataset.username,
        number: row.querySelector(".wa-contact-number").value.trim(),
        alerts: row.querySelector(".wa-contact-alerts").checked,
        skip: Array.from(row.querySelectorAll(".wa-type")).filter(function (i) { return !i.checked; }).map(function (i) { return i.value; }),
        pauseUntil: row.querySelector(".wa-contact-pause").value
    };

    setButtonLoading(button, true);
    let result = null;
    await guardAsync("waContact-" + payload.username, async function () { result = await apiRequest("saveWhatsAppContact", payload); });
    setButtonLoading(button, false);

    if (!result || !result.success) return showNotification("Not saved", result?.message || "Couldn't save the number.");

    waState.contacts = result.contacts || waState.contacts;
    paintWhatsAppContacts();
    showNotification("Saved", "WhatsApp details saved.");

}

async function sendWhatsAppTest() {

    const button = document.getElementById("waTestButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("waTest", async function () { result = await apiRequest("sendWhatsAppTest", {}, { timeoutMs: 60000 }); });
    setButtonLoading(button, false);

    if (!result || !result.success) return showNotification("Test not sent", result?.message || "Couldn't send the test.");

    waState.log = result.log || waState.log;
    paintWhatsAppLog();
    const r = result.result || {};
    showNotification(/^sent/i.test(r.status) ? "Test sent" : "Test logged",
        /^sent/i.test(r.status) ? "Check your WhatsApp." : (r.status || "") + ". See Recent messages below for the wording.");

}

async function previewWhatsAppToday() {

    const box = document.getElementById("waPreview");
    const button = document.getElementById("waPreviewButton");
    setButtonLoading(button, true);
    const result = await apiRequest("previewWhatsAppToday", {}, { timeoutMs: 60000 });
    setButtonLoading(button, false);

    if (!box) return;
    box.hidden = false;

    if (!result || !result.success) {
        box.innerHTML = `<div class="empty-state">${escapeHtml(result?.message || "Couldn't build the preview.")}</div>`;
        return;
    }

    const list = result.messages || [];
    box.innerHTML = `
        <div class="wa-preview-head">
            <h4>Today's messages (${list.length})</h4>
            <span>Nothing is sent from this preview.</span>
        </div>
        ${list.length ? list.map(function (m) {
            return `
                <div class="wa-log-row">
                    <div class="wa-log-head">
                        <strong>${escapeHtml(m.to)}</strong>
                        <span>${escapeHtml(WA_TYPE_NAMES[m.type] || m.type)} at ${escapeHtml(m.time)} IST</span>
                        ${m.number ? "" : `<span class="wa-status is-skipped">No number</span>`}
                    </div>
                    <p>${escapeHtml(m.text)}</p>
                </div>`;
        }).join("") : `<div class="empty-state">No messages for today. Check that people have reminders switched on and have tasks.</div>`}
    `;
    box.scrollIntoView({ block: "nearest" });

}
