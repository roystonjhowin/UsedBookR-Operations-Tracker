/* =========================================================
   EXCELSO — ADMIN TOOLS (frontend)  —  v9
   Loaded after script.js and ai.js. Founder / Operations Head only
   (the server checks every action again).

   - Delete tasks, comments, backlog items (sheet rows go too)
   - Add / edit / delete regular tasks; edit backlog from its drawer
   - Activity Log: the real sheet, searchable, with "Clear log"
   - Team & Departments: add / edit / remove people and departments;
     renames are applied to every sheet by the server
========================================================= */

let regularTaskOwnerPicker = null;
let adminTeam = null;
let adminUsage = {};
let adminTeamLoading = false;
let activityEntries = null;
let activityLoadedAt = 0;
let activityLoading = false;

const ADMIN_MODALS = ["regularTaskModal", "teamMemberModal", "departmentModal", "kbNoteModal"];

document.addEventListener("DOMContentLoaded", function () {
    initializeAdminModals();
    initializeDeleteButtons();
    initializeRegularTaskEditor();
    initializeActivityAdmin();
    initializeTeamAdmin();
    initializeDepartmentAdmin();
});

function resetAdminState() {
    adminTeam = null;
    adminUsage = {};
    activityEntries = null;
    activityLoadedAt = 0;
    closeAdminModals();
}

/* =========================================================
   MODALS
========================================================= */

function openAdminModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = "flex";
    document.body.classList.add("modal-open");
}

function closeAdminModal(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.style.display === "none") return;
    modal.style.display = "none";
    modal.querySelectorAll(".owner-picker.is-open").forEach(function (p) { p._picker?.close(); });
    const anyOpen = document.querySelector(".modal-overlay[style*='flex'], .detail-drawer[style*='block'], .regular-task-update-modal[style*='flex']");
    if (!anyOpen) document.body.classList.remove("modal-open");
}

function closeAdminModals() {
    ADMIN_MODALS.forEach(closeAdminModal);
}

function initializeAdminModals() {
    document.addEventListener("click", function (event) {
        const closer = event.target.closest("[data-close-modal]");
        if (closer) { closeAdminModal(closer.dataset.closeModal); return; }
        if (event.target.classList?.contains("modal-overlay") && ADMIN_MODALS.indexOf(event.target.id) !== -1) closeAdminModal(event.target.id);
    });
}

function showFormError(id, message) {
    const box = document.getElementById(id);
    if (!box) return;
    box.textContent = message || "";
    box.style.display = message ? "block" : "none";
}

/* =========================================================
   DELETE: TASKS, COMMENTS, BACKLOG ITEMS
========================================================= */

function initializeDeleteButtons() {

    document.getElementById("taskDetailDeleteButton")?.addEventListener("click", function () {
        if (taskDetailCurrentId) deleteTaskEverywhere(taskDetailCurrentId);
    });

    document.getElementById("deleteTaskModalButton")?.addEventListener("click", function () {
        const id = getInput("editTaskId");
        if (id) deleteTaskEverywhere(id);
    });

    document.addEventListener("click", function (event) {
        const button = event.target.closest(".comment-delete");
        if (button) deleteCommentEverywhere(button.dataset.taskId, button.dataset.commentId);
    });

    document.getElementById("deleteBacklogButton")?.addEventListener("click", function () {
        const id = getInput("editBacklogId");
        if (id) deleteBacklogEverywhere(id);
    });

    document.getElementById("backlogDetailEditButton")?.addEventListener("click", function () {
        const item = backlogTasks.find(function (b) { return b.backlogId === backlogDetailCurrentId; });
        if (!item) return;
        closeBacklogDetailDrawer();
        openBacklogItemModal(item);
    });

    document.getElementById("backlogDetailDeleteButton")?.addEventListener("click", function () {
        if (backlogDetailCurrentId) deleteBacklogEverywhere(backlogDetailCurrentId);
    });

}

async function deleteTaskEverywhere(taskId) {

    if (!isPrivilegedUser()) return;
    const task = tasks.find(function (t) { return t.taskId === taskId; });
    const checklistCount = getChecklist(taskId).length;
    const commentCount = getComments(taskId).length;

    const extra = [];
    if (checklistCount) extra.push(checklistCount + " checklist item" + (checklistCount === 1 ? "" : "s"));
    if (commentCount) extra.push(commentCount + " comment" + (commentCount === 1 ? "" : "s"));

    if (!confirm("Delete " + taskId + (task ? " \u201c" + task.task + "\u201d" : "") + "?\n\n" +
        "It will be removed from the Master Tasks sheet" + (extra.length ? ", along with its " + extra.join(" and ") : "") +
        ". This can't be undone.")) return;

    let result = null;
    await guardAsync("delete-" + taskId, async function () {
        result = await apiRequest("deleteTask", { taskId: taskId });
    });

    if (!result || !result.success) return showNotification("Not deleted", result?.message || "Couldn't delete the task.");

    tasks = tasks.filter(function (t) { return t.taskId !== taskId; });
    delete allChecklists[taskId];
    delete allComments[taskId];
    lastSignature = "";
    persistLocalCacheSoon();

    if (taskDetailCurrentId === taskId) closeTaskDetailDrawer();
    closeTaskModal();
    renderCurrentPage();
    showNotification("Deleted", taskId + " was deleted.");

}

async function deleteCommentEverywhere(taskId, commentId) {

    if (!isPrivilegedUser() || !taskId || !commentId) return;
    const comment = getComments(taskId).find(function (c) { return c.commentId === commentId; });
    if (!confirm("Delete this comment" + (comment ? " by " + comment.user : "") + "? It will be removed from the Task Comments sheet.")) return;

    let result = null;
    await guardAsync("delete-" + commentId, async function () {
        result = await apiRequest("deleteComment", { commentId: commentId });
    });

    if (!result || !result.success) return showNotification("Not deleted", result?.message || "Couldn't delete the comment.");

    allComments[String(taskId)] = Array.isArray(result.comments) ? result.comments
        : getComments(taskId).filter(function (c) { return c.commentId !== commentId; });
    lastSignature = "";
    persistLocalCacheSoon();
    refreshOpenDrawers();
    if (currentPage === "backlog") renderBacklog();
    showNotification("Deleted", "Comment deleted.");

}

async function deleteBacklogEverywhere(backlogId) {

    if (!isPrivilegedUser()) return;
    const item = backlogTasks.find(function (b) { return b.backlogId === backlogId; });
    const commentCount = getComments(backlogId).length;

    if (!confirm("Delete " + backlogId + (item ? " \u201c" + item.task + "\u201d" : "") + "?\n\n" +
        "It will be removed from the Backlog sheet" + (commentCount ? " with its " + commentCount + " comment" + (commentCount === 1 ? "" : "s") : "") +
        ". This can't be undone.")) return;

    let result = null;
    await guardAsync("delete-" + backlogId, async function () {
        result = await apiRequest("deleteBacklogTask", { backlogId: backlogId });
    });

    if (!result || !result.success) return showNotification("Not deleted", result?.message || "Couldn't delete the backlog item.");

    backlogTasks = backlogTasks.filter(function (b) { return b.backlogId !== backlogId; });
    delete allComments[backlogId];
    lastSignature = "";
    persistLocalCacheSoon();

    closeBacklogItemModal();
    closeBacklogDetailDrawer();
    if (currentPage === "backlog") renderBacklog();
    showNotification("Deleted", backlogId + " was deleted.");

}

/* =========================================================
   REGULAR TASKS: ADD / EDIT / DELETE
========================================================= */

function initializeRegularTaskEditor() {

    regularTaskOwnerPicker = createOwnerPicker(document.getElementById("regularTaskOwnerPicker"));
    if (regularTaskOwnerPicker) extraOwnerPickers.push(regularTaskOwnerPicker);

    document.getElementById("regularTaskAddButton")?.addEventListener("click", function () { openRegularTaskModal(null); });

    document.getElementById("regularTaskForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        saveRegularTaskFromModal();
    });

    document.getElementById("regularTaskDeleteButton")?.addEventListener("click", deleteRegularTaskFromModal);

}

function openRegularTaskModal(regularTaskId) {

    if (!isPrivilegedUser()) return;

    const task = regularTaskId ? findRegularTask(regularTaskId) : null;
    if (regularTaskId && !task) return showNotification("Error", "Regular task could not be found.");

    fillDepartmentSelect("regularTaskDepartment", "Select Department");
    showFormError("regularTaskFormError", "");

    setText("regularTaskModalTitle", task ? "Edit " + task.regularTaskId : "Add Regular Task");
    setInput("regularTaskEditId", task ? task.regularTaskId : "");
    setInput("regularTaskName", task ? task.task : "");
    setInput("regularTaskDepartment", task ? task.department : (getInput("regularTasksDepartmentFilter") || ""));
    setInput("regularTaskFrequency", task ? task.expectedTime : "");
    setInput("regularTaskPriority", task && task.priority ? task.priority : "Medium");
    setInput("regularTaskExpectedDate", task ? formatDateForInput(task.expectedDate) : "");
    regularTaskOwnerPicker?.setValue(task ? task.assignedTo : "");

    const del = document.getElementById("regularTaskDeleteButton");
    if (del) del.style.display = task ? "" : "none";
    const move = document.getElementById("regularTaskMoveButton");
    if (move) move.style.display = task ? "" : "none";

    openAdminModal("regularTaskModal");
    setTimeout(function () { document.getElementById("regularTaskName")?.focus(); }, 50);

}

async function saveRegularTaskFromModal() {

    const id = getInput("regularTaskEditId");
    const payload = {
        regularTaskId: id,
        task: getInput("regularTaskName").trim(),
        department: getInput("regularTaskDepartment"),
        assignedTo: regularTaskOwnerPicker ? regularTaskOwnerPicker.getValue() : "",
        expectedTime: getInput("regularTaskFrequency").trim(),
        priority: getInput("regularTaskPriority") || "Medium",
        expectedDate: getInput("regularTaskExpectedDate")
    };

    if (!payload.task) return showFormError("regularTaskFormError", "Enter the task name.");
    if (!payload.department) return showFormError("regularTaskFormError", "Choose a department.");
    if (!payload.expectedTime) return showFormError("regularTaskFormError", "Say how often it happens, e.g. weekly.");
    showFormError("regularTaskFormError", "");

    const button = document.getElementById("regularTaskSaveButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("regularTaskSave", async function () {
        result = await apiRequest(id ? "updateRegularTask" : "createRegularTask", payload);
    });
    setButtonLoading(button, false);

    if (!result || !result.success || !result.regularTask) {
        return showFormError("regularTaskFormError", result?.message || "Couldn't save the regular task.");
    }

    const saved = result.regularTask;
    const index = regularTasks.findIndex(function (r) { return r.regularTaskId === saved.regularTaskId; });
    if (index !== -1) regularTasks[index] = saved; else regularTasks.push(saved);
    lastSignature = "";
    persistLocalCacheSoon();
    populateRegularTasksDepartmentFilter();

    closeAdminModal("regularTaskModal");
    if (currentPage === "regularTasks") renderRegularTasks();
    showNotification("Saved", id ? saved.regularTaskId + " updated." : "Regular task " + saved.regularTaskId + " added.");

}

async function deleteRegularTaskFromModal() {

    const id = getInput("regularTaskEditId");
    if (!id) return;
    const task = findRegularTask(id);
    const checklistCount = getChecklist(id).length;

    if (!confirm("Delete " + id + (task ? " \u201c" + task.task + "\u201d" : "") + "?\n\n" +
        "It will be removed from the Regular Tasks sheet" + (checklistCount ? " with its " + checklistCount + " checklist item" + (checklistCount === 1 ? "" : "s") : "") +
        ". Past updates stay in Regular Task Updates as history.")) return;

    let result = null;
    await guardAsync("regularTaskDelete", async function () {
        result = await apiRequest("deleteRegularTask", { regularTaskId: id });
    });

    if (!result || !result.success) return showFormError("regularTaskFormError", result?.message || "Couldn't delete the regular task.");

    regularTasks = regularTasks.filter(function (r) { return r.regularTaskId !== id; });
    delete allChecklists[id];
    delete regularLatest[id];
    lastSignature = "";
    persistLocalCacheSoon();
    populateRegularTasksDepartmentFilter();

    closeAdminModal("regularTaskModal");
    if (currentPage === "regularTasks") renderRegularTasks();
    showNotification("Deleted", id + " was deleted.");

}

/* =========================================================
   ACTIVITY LOG (the real sheet) + CLEAR
========================================================= */

function initializeActivityAdmin() {

    document.getElementById("activitySearch")?.addEventListener("input", debounce(function () {
        if (currentPage === "activity") renderAdminActivity();
    }, 150));

    document.getElementById("activityClearButton")?.addEventListener("click", clearActivityLogFromPage);

    document.getElementById("activityTimeline")?.addEventListener("click", function (event) {
        if (event.target.closest(".activity-retry")) { activityEntries = null; renderAdminActivity(); }
    });

}

async function renderAdminActivity() {

    const container = document.getElementById("activityTimeline");
    if (!container) return;

    setText("activityIntro", "Every change saved through Excelso, newest first. Click an ID to open it.");

    const stale = Date.now() - activityLoadedAt > 60000;

    if ((!activityEntries || stale) && !activityLoading) {
        activityLoading = true;
        if (!activityEntries) container.innerHTML = `<div class="skeleton-card-grid">${skeletonCards(3)}</div>`;
        const result = await apiRequest("getActivityLog", { limit: 500 }, { silent: true });
        activityLoading = false;
        if (result && result.success) {
            activityEntries = result.entries || [];
            activityLoadedAt = Date.now();
        } else if (!activityEntries) {
            container.innerHTML = `<div class="empty-state">${escapeHtml(result?.message || "Couldn't load the activity log.")} <button type="button" class="link-button activity-retry">Try again</button></div>`;
            return;
        }
        if (currentPage !== "activity") return;
    }

    if (!activityEntries) return;

    const query = getInput("activitySearch").trim().toLowerCase();
    const shown = activityEntries.filter(function (e) {
        if (!query) return true;
        return (e.taskId + " " + e.action + " " + e.changedBy + " " + e.department + " " + e.notes).toLowerCase().indexOf(query) !== -1;
    });

    if (!activityEntries.length) {
        container.innerHTML = `<div class="empty-state">The activity log is empty.</div>`;
        return;
    }
    if (!shown.length) {
        container.innerHTML = `<div class="empty-state">No entries match "${escapeHtml(query)}".</div>`;
        return;
    }

    container.innerHTML = `<div class="log-list">` + shown.slice(0, 300).map(function (e) {
        const isDelete = /deleted|removed|cleared/i.test(e.action);
        const linkable = /^(T|BL|RT|KB)\d{3,}$/.test(e.taskId);
        return `
            <div class="log-row${isDelete ? " log-row-delete" : ""}">
                <div class="log-when">${escapeHtml(e.timestamp)}</div>
                <div class="log-main">
                    <div class="log-head">
                        <strong>${escapeHtml(e.action || "Change")}</strong>
                        ${e.taskId ? (linkable ? `<button type="button" class="ai-task-link" data-task-id="${escapeHtml(e.taskId)}">${escapeHtml(e.taskId)}</button>` : `<span class="log-id">${escapeHtml(e.taskId)}</span>`) : ""}
                        ${e.department ? `<span class="log-dept">${escapeHtml(e.department)}</span>` : ""}
                    </div>
                    ${e.notes ? `<p>${escapeHtml(e.notes)}</p>` : ""}
                </div>
                <div class="log-by">${escapeHtml(e.changedBy || "")}</div>
            </div>`;
    }).join("") + `</div>` + (shown.length > 300 ? `<p class="log-more">Showing the newest 300 of ${shown.length}. Search to narrow down.</p>` : "");

}

async function clearActivityLogFromPage() {

    if (!isPrivilegedUser()) return;
    const days = parseInt(getInput("activityClearRange"), 10) || 0;
    const what = days ? "every entry older than " + days + " days" : "EVERY entry";

    if (!confirm("Clear " + what + " from the Activity Log sheet?\n\nThis can't be undone. The AI Assistant will no longer see those changes.")) return;

    const button = document.getElementById("activityClearButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("activityClear", async function () {
        result = await apiRequest("clearActivityLog", { olderThanDays: days }, { timeoutMs: 60000 });
    });
    setButtonLoading(button, false);

    if (!result || !result.success) return showNotification("Not cleared", result?.message || "Couldn't clear the activity log.");

    activityEntries = null;
    showNotification("Cleared", result.removed + " entr" + (result.removed === 1 ? "y" : "ies") + " removed" + (result.kept ? ", " + result.kept + " kept." : "."));
    renderAdminActivity();

}

/* =========================================================
   TEAM & DEPARTMENTS PAGE
========================================================= */

async function renderAdminPage(force) {

    if (!isPrivilegedUser()) return showPage("dashboard");

    renderTeamList();
    renderDepartmentAdminList();

    if ((adminTeam && !force) || adminTeamLoading) return;

    adminTeamLoading = true;
    const result = await apiRequest("getTeam", {}, { silent: true });
    adminTeamLoading = false;

    if (result && result.success) {
        adminTeam = result.team || [];
        adminUsage = result.usage || {};
        if (Array.isArray(result.departments)) setDepartments(result.departments);
    } else if (!adminTeam) {
        const list = document.getElementById("teamList");
        if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(result?.message || "Couldn't load the team.")}</div>`;
        return;
    }

    if (currentPage === "admin") { renderTeamList(); renderDepartmentAdminList(); }

}

function onDepartmentsChanged() {
    if (currentPage === "admin") renderDepartmentAdminList();
    if (currentPage === "departments") renderDepartmentCards();
}

/* ---------- team ---------- */

function initials(name) {
    const words = String(name || "").replace(/\./g, " ").split(/\s+/).filter(Boolean);
    return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] || "?").substring(0, 2)).toUpperCase();
}

function isAdminRoleName(role) {
    const r = String(role || "").trim().toLowerCase();
    return r === "founder" || r === "operations head";
}

function openTaskCountFor(name) {
    const key = normalizePersonName(name);
    return tasks.filter(function (t) {
        return t.status !== "Completed" && splitOwners(t.assignedTo).some(function (o) { return normalizePersonName(o) === key; });
    }).length;
}

function renderTeamList() {

    const list = document.getElementById("teamList");
    if (!list) return;

    if (!adminTeam) {
        list.innerHTML = `<div class="skeleton-bar" style="width:80%; margin:22px;"></div><div class="skeleton-bar" style="width:60%; margin:0 22px 22px;"></div>`;
        return;
    }

    if (!adminTeam.length) {
        list.innerHTML = `<div class="empty-state">No one in the Users sheet yet.</div>`;
        return;
    }

    const sorted = adminTeam.slice().sort(function (a, b) {
        if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
    });

    list.innerHTML = sorted.map(function (u) {
        const isMe = currentUser && String(currentUser.username).toLowerCase() === String(u.username).toLowerCase();
        const open = openTaskCountFor(u.name);
        return `
            <div class="team-row${u.status !== "Active" ? " is-inactive" : ""}">
                <div class="team-avatar${isAdminRoleName(u.role) ? " is-admin" : ""}">${escapeHtml(initials(u.name))}</div>
                <div class="team-main">
                    <strong>${escapeHtml(u.name || u.username)}${isMe ? ` <span class="team-you">you</span>` : ""}</strong>
                    <span>${escapeHtml(u.role || "Team Member")}${u.primaryDepartment ? ", " + escapeHtml(u.primaryDepartment) : ""}</span>
                </div>
                <div class="team-tags">
                    ${u.status !== "Active" ? `<span class="team-tag team-tag-off">Inactive</span>` : ""}
                    ${u.aiAccess && !isAdminRoleName(u.role) ? `<span class="team-tag">AI chat</span>` : ""}
                    <span class="team-tag team-tag-count" title="Open tasks">${open} open</span>
                </div>
                <button type="button" class="table-action team-edit" data-username="${escapeHtml(u.username)}">Edit</button>
            </div>`;
    }).join("");

}

function initializeTeamAdmin() {

    document.getElementById("teamAddButton")?.addEventListener("click", function () { openTeamMemberModal(null); });

    document.getElementById("teamList")?.addEventListener("click", function (event) {
        const edit = event.target.closest(".team-edit");
        if (!edit) return;
        const person = (adminTeam || []).find(function (u) { return u.username === edit.dataset.username; });
        if (person) openTeamMemberModal(person);
    });

    document.getElementById("teamMemberForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        saveTeamMember();
    });

    document.getElementById("teamMemberCoordination")?.addEventListener("change", function (event) {
        if (event.target.type !== "checkbox") return;
        const boxes = document.querySelectorAll("#teamMemberCoordination input[type='checkbox']");
        if (event.target.value === "All" && event.target.checked) {
            boxes.forEach(function (b) { if (b.value !== "All") b.checked = false; });
        } else if (event.target.checked) {
            boxes.forEach(function (b) { if (b.value === "All") b.checked = false; });
        }
    });

    document.getElementById("teamMemberDeleteButton")?.addEventListener("click", showRemovePanel);
    document.getElementById("teamMemberRemoveCancel")?.addEventListener("click", function () {
        document.getElementById("teamMemberRemoveGroup").hidden = true;
    });
    document.getElementById("teamMemberRemoveConfirm")?.addEventListener("click", removeTeamMember);

}

function fillTeamDepartmentFields(primary, coordination) {

    const select = document.getElementById("teamMemberDepartment");
    if (select) {
        const list = ["All"].concat(DEPARTMENTS);
        if (primary && list.map(function (d) { return d.toLowerCase(); }).indexOf(primary.toLowerCase()) === -1) list.push(primary);
        select.innerHTML = `<option value="">None</option>` + list.map(function (d) {
            return `<option value="${escapeHtml(d)}">${d === "All" ? "All departments" : escapeHtml(d)}</option>`;
        }).join("");
        const match = list.find(function (d) { return d.toLowerCase() === String(primary || "").toLowerCase(); });
        select.value = match || "";
    }

    const chosen = String(coordination || "").split(/\s*,\s*/).map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean);
    const box = document.getElementById("teamMemberCoordination");
    if (box) {
        box.innerHTML = ["All"].concat(DEPARTMENTS).map(function (d) {
            const on = chosen.indexOf(d.toLowerCase()) !== -1;
            return `<label class="chip-check${on ? " is-on" : ""}"><input type="checkbox" value="${escapeHtml(d)}" ${on ? "checked" : ""}><span>${d === "All" ? "All departments" : escapeHtml(d)}</span></label>`;
        }).join("");
        box.querySelectorAll("input").forEach(function (input) {
            input.addEventListener("change", function () {
                box.querySelectorAll(".chip-check").forEach(function (l) { l.classList.toggle("is-on", l.querySelector("input").checked); });
            });
        });
    }

}

function openTeamMemberModal(person) {

    showFormError("teamMemberFormError", "");
    document.getElementById("teamMemberRemoveGroup").hidden = true;

    setText("teamMemberModalTitle", person ? "Edit " + (person.name || person.username) : "Add person");
    setInput("teamMemberOriginalUsername", person ? person.username : "");
    setInput("teamMemberName", person ? person.name : "");
    setInput("teamMemberUsername", person ? person.username : "");
    setInput("teamMemberRole", person ? person.role : "");
    setInput("teamMemberPassword", "");
    setInput("teamMemberStatus", person ? person.status : "Active");
    const ai = document.getElementById("teamMemberAi");
    if (ai) ai.checked = !!(person && person.aiAccess);

    setText("teamMemberPasswordLabel", person ? "New password (leave empty to keep)" : "Password *");
    setText("teamMemberPasswordHint", person
        ? "Only fill this in to reset their password. They'll be signed out."
        : "Share it with them privately. It's stored encrypted.");

    fillTeamDepartmentFields(person ? person.primaryDepartment : "", person ? person.coordinationDepartments : "");

    const isMe = person && currentUser && String(currentUser.username).toLowerCase() === String(person.username).toLowerCase();
    const del = document.getElementById("teamMemberDeleteButton");
    if (del) del.style.display = person && !isMe ? "" : "none";

    openAdminModal("teamMemberModal");
    setTimeout(function () { document.getElementById("teamMemberName")?.focus(); }, 50);

}

async function saveTeamMember() {

    const originalUsername = getInput("teamMemberOriginalUsername");
    const coordination = Array.from(document.querySelectorAll("#teamMemberCoordination input:checked")).map(function (b) { return b.value; });

    const member = {
        name: getInput("teamMemberName").trim(),
        username: getInput("teamMemberUsername").trim(),
        role: getInput("teamMemberRole").trim() || "Team Member",
        primaryDepartment: getInput("teamMemberDepartment"),
        coordinationDepartments: coordination.join(", "),
        password: getInput("teamMemberPassword"),
        status: getInput("teamMemberStatus") || "Active",
        aiAccess: !!document.getElementById("teamMemberAi")?.checked
    };

    if (!member.name) return showFormError("teamMemberFormError", "Enter the person's name.");
    if (/[,;\/&]/.test(member.name)) return showFormError("teamMemberFormError", "Names can't contain , ; / or & — those separate owners on a task.");
    if (!member.username) return showFormError("teamMemberFormError", "Enter a username for signing in.");
    if (!originalUsername && member.password.length < 6) return showFormError("teamMemberFormError", "The password needs at least 6 characters.");
    if (originalUsername && member.password && member.password.length < 6) return showFormError("teamMemberFormError", "The new password needs at least 6 characters.");

    const before = originalUsername ? (adminTeam || []).find(function (u) { return u.username === originalUsername; }) : null;
    if (before && before.name !== member.name) {
        const count = openTaskCountFor(before.name);
        if (!confirm("Rename " + before.name + " to " + member.name + "?\n\nTheir name will be updated on every task, regular task, comment and log in the spreadsheet" +
            (count ? " (" + count + " open tasks)" : "") + ".")) return;
    }

    showFormError("teamMemberFormError", "");
    const button = document.getElementById("teamMemberSaveButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("teamSave", async function () {
        result = await apiRequest(originalUsername ? "updateTeamMember" : "addTeamMember",
            originalUsername ? { originalUsername: originalUsername, member: member } : { member: member }, { timeoutMs: 90000 });
    });
    setButtonLoading(button, false);

    if (!result || !result.success) return showFormError("teamMemberFormError", result?.message || "Couldn't save.");

    adminTeam = result.team || adminTeam;
    closeAdminModal("teamMemberModal");
    renderTeamList();
    showNotification("Saved", originalUsername
        ? member.name + " updated" + (result.cellsChanged ? " (" + result.cellsChanged + " cells renamed across the sheets)." : ".")
        : member.name + " added. They can sign in as \u201c" + member.username + "\u201d.");

    if (result.selfChanged) showNotification("Saved", "Your own details changed. Sign out and back in to see them everywhere.");
    loadCoreData({ fresh: true, silent: true });

}

function showRemovePanel() {

    const username = getInput("teamMemberOriginalUsername");
    const person = (adminTeam || []).find(function (u) { return u.username === username; });
    if (!person) return;

    const open = openTaskCountFor(person.name);
    setText("teamMemberRemoveText",
        "Remove " + person.name + " from the Users sheet? They won't be able to sign in. " +
        (open ? "They own " + open + " open task" + (open === 1 ? "" : "s") + ". " : "") +
        "Past comments and logs keep their name. To keep them on record but block sign-in, set Status to Inactive and save instead.");

    const select = document.getElementById("teamMemberReassign");
    if (select) {
        select.innerHTML = `<option value="">Nobody — keep their name on the tasks</option>` +
            (adminTeam || []).filter(function (u) { return u.username !== username && u.status === "Active"; })
                .map(function (u) { return `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`; }).join("");
    }

    document.getElementById("teamMemberRemoveGroup").hidden = false;

}

async function removeTeamMember() {

    const username = getInput("teamMemberOriginalUsername");
    const reassignTo = getInput("teamMemberReassign");
    const button = document.getElementById("teamMemberRemoveConfirm");

    setButtonLoading(button, true);
    let result = null;
    await guardAsync("teamDelete", async function () {
        result = await apiRequest("deleteTeamMember", { username: username, reassignTo: reassignTo }, { timeoutMs: 90000 });
    });
    setButtonLoading(button, false);

    if (!result || !result.success) return showFormError("teamMemberFormError", result?.message || "Couldn't remove them.");

    adminTeam = result.team || adminTeam;
    closeAdminModal("teamMemberModal");
    renderTeamList();
    showNotification("Removed", "Removed from the team" + (reassignTo ? "; their tasks now belong to " + reassignTo + "." : "."));
    loadCoreData({ fresh: true, silent: true });

}

/* ---------- departments ---------- */

function departmentUsage(name) {
    return adminUsage[String(name || "").toLowerCase()] || { tasks: 0, regularTasks: 0, backlog: 0, people: 0 };
}

function usageText(u) {
    const bits = [];
    if (u.tasks) bits.push(u.tasks + " task" + (u.tasks === 1 ? "" : "s"));
    if (u.regularTasks) bits.push(u.regularTasks + " regular");
    if (u.backlog) bits.push(u.backlog + " backlog");
    if (u.people) bits.push(u.people + (u.people === 1 ? " person" : " people"));
    return bits.length ? bits.join(", ") : "Not used yet";
}

function renderDepartmentAdminList() {

    const list = document.getElementById("departmentAdminList");
    if (!list) return;

    list.innerHTML = DEPARTMENTS.map(function (d) {
        const u = departmentUsage(d);
        return `
            <div class="dept-row">
                <span class="department-code">${escapeHtml(getDepartmentCode(d))}</span>
                <div class="dept-main">
                    <strong>${escapeHtml(d)}</strong>
                    <span>${adminTeam ? escapeHtml(usageText(u)) : "…"}</span>
                </div>
                <button type="button" class="table-action dept-rename" data-department="${escapeHtml(d)}">Rename</button>
                <button type="button" class="table-action table-action-danger dept-remove" data-department="${escapeHtml(d)}">Remove</button>
            </div>`;
    }).join("");

}

function initializeDepartmentAdmin() {

    document.getElementById("departmentAddForm")?.addEventListener("submit", async function (event) {
        event.preventDefault();
        const input = document.getElementById("departmentAddInput");
        const name = String(input?.value || "").replace(/\s+/g, " ").trim();
        if (!name) return;
        if (DEPARTMENTS.some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) {
            return showNotification("Not added", "\u201c" + name + "\u201d already exists.");
        }

        const button = event.target.querySelector("button");
        setButtonLoading(button, true);
        let result = null;
        await guardAsync("deptAdd", async function () { result = await apiRequest("addDepartment", { name: name }); });
        setButtonLoading(button, false);

        if (!result || !result.success) return showNotification("Not added", result?.message || "Couldn't add the department.");

        input.value = "";
        setDepartments(result.departments);
        persistLocalCacheSoon();
        renderDepartmentAdminList();
        showNotification("Added", name + " is now in every department list.");
    });

    document.getElementById("departmentAdminList")?.addEventListener("click", function (event) {
        const rename = event.target.closest(".dept-rename");
        if (rename) return openDepartmentModal("rename", rename.dataset.department);
        const remove = event.target.closest(".dept-remove");
        if (remove) return openDepartmentModal("remove", remove.dataset.department);
    });

    document.getElementById("departmentForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        saveDepartmentModal();
    });

}

function openDepartmentModal(mode, name) {

    showFormError("departmentFormError", "");
    setInput("departmentModalMode", mode);
    setInput("departmentModalOriginal", name);

    const u = departmentUsage(name);
    const used = u.tasks + u.regularTasks + u.backlog + u.people;
    const renameGroup = document.getElementById("departmentRenameGroup");
    const moveGroup = document.getElementById("departmentMoveGroup");
    const save = document.getElementById("departmentSaveButton");

    if (mode === "rename") {
        setText("departmentModalTitle", "Rename department");
        setText("departmentModalText", "\u201c" + name + "\u201d will be renamed on every task, regular task, backlog item, person and log in the spreadsheet.");
        setInput("departmentNewName", name);
        renameGroup.hidden = false;
        moveGroup.hidden = true;
        save.textContent = "Rename";
        save.classList.remove("danger-button");
        save.classList.add("primary-button");
    } else {
        setText("departmentModalTitle", "Remove " + name);
        setText("departmentModalText", used
            ? name + " is used by " + usageText(u) + ". Choose where that work goes, then it's removed from every department list."
            : "Nothing uses " + name + ". It will be removed from every department list.");
        renameGroup.hidden = true;
        moveGroup.hidden = !used;
        const select = document.getElementById("departmentMoveTo");
        if (select) {
            select.innerHTML = `<option value="">Choose a department…</option>` + DEPARTMENTS.filter(function (d) { return d !== name; })
                .map(function (d) { return `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; }).join("");
        }
        save.textContent = "Remove";
        save.classList.remove("primary-button");
        save.classList.add("danger-button");
    }

    openAdminModal("departmentModal");
    setTimeout(function () { document.getElementById(mode === "rename" ? "departmentNewName" : "departmentMoveTo")?.focus(); }, 50);

}

async function saveDepartmentModal() {

    const mode = getInput("departmentModalMode");
    const original = getInput("departmentModalOriginal");
    let action, payload;

    if (mode === "rename") {
        const newName = getInput("departmentNewName").replace(/\s+/g, " ").trim();
        if (!newName) return showFormError("departmentFormError", "Enter the new name.");
        if (newName === original) return closeAdminModal("departmentModal");
        action = "renameDepartment";
        payload = { oldName: original, newName: newName };
    } else {
        const moveGroup = document.getElementById("departmentMoveGroup");
        const moveTo = getInput("departmentMoveTo");
        if (!moveGroup.hidden && !moveTo) return showFormError("departmentFormError", "Choose where to move the work.");
        action = "removeDepartment";
        payload = { name: original, moveTo: moveTo };
    }

    showFormError("departmentFormError", "");
    const button = document.getElementById("departmentSaveButton");
    setButtonLoading(button, true);
    let result = null;
    await guardAsync("deptSave", async function () { result = await apiRequest(action, payload, { timeoutMs: 120000 }); });
    setButtonLoading(button, false);

    if (!result || !result.success) return showFormError("departmentFormError", result?.message || "Couldn't save the change.");

    closeAdminModal("departmentModal");
    setDepartments(result.departments);
    if (currentDepartment === original) currentDepartment = mode === "rename" ? payload.newName : (result.movedTo || "");
    showNotification(mode === "rename" ? "Renamed" : "Removed",
        (mode === "rename" ? original + " is now " + payload.newName : original + " removed" + (result.movedTo ? ", work moved to " + result.movedTo : "")) +
        (result.cellsChanged ? " (" + result.cellsChanged + " cells updated)." : "."));

    adminTeam = null;              // reload usage counts
    renderAdminPage(true);
    loadCoreData({ fresh: true, silent: true });

}
