/* =========================================================
   EXCELSO — MOVE / COPY BETWEEN LISTS (frontend)  —  v9
   Loaded after script.js, ai.js and admin.js.
   Founder / Operations Head only (the server checks again).

   All Tasks task  → Backlog, or → Regular task
   Regular task    → Backlog, or → a copy in All Tasks
   Backlog item    → All Tasks

   Comments always travel with the item. Checklists travel when the
   new list has checklists; for the backlog they are written into
   the description.
========================================================= */

let moveOwnerPicker = null;
let moveContext = null;   // { source: "task"|"regular"|"backlog", id, item, target }

const MOVE_OPTIONS = {
    task: [
        {
            target: "backlog", title: "Backlog",
            text: "Park it for later. Comments move with it; the checklist, last action and remarks are added to the description.",
            confirm: "Move to backlog"
        },
        {
            target: "regular", title: "Regular task",
            text: "Turn it into recurring work. Owners, checklist and comments move with it.",
            confirm: "Make it a regular task"
        }
    ],
    regular: [
        {
            target: "task", title: "Copy to All Tasks",
            text: "Create a one-off task from it. The regular task stays as it is.",
            confirm: "Create the copy"
        },
        {
            target: "backlog", title: "Backlog",
            text: "Stop the recurring task and park it. Its past updates stay in the update history.",
            confirm: "Move to backlog"
        }
    ],
    backlog: [
        {
            target: "task", title: "All Tasks",
            text: "Make it an active task with owners and a due date. Comments move with it.",
            confirm: "Move to All Tasks"
        }
    ]
};

document.addEventListener("DOMContentLoaded", function () {

    moveOwnerPicker = createOwnerPicker(document.getElementById("moveOwnerPicker"));
    if (moveOwnerPicker) extraOwnerPickers.push(moveOwnerPicker);

    document.getElementById("moveTaskModalButton")?.addEventListener("click", function () {
        const id = getInput("editTaskId");
        if (id) openMoveModal("task", id);
    });

    document.getElementById("taskDetailMoveButton")?.addEventListener("click", function () {
        if (taskDetailCurrentId) openMoveModal("task", taskDetailCurrentId);
    });

    document.getElementById("regularTaskMoveButton")?.addEventListener("click", function () {
        const id = getInput("regularTaskEditId");
        if (id) openMoveModal("regular", id);
    });

    document.getElementById("moveBacklogModalButton")?.addEventListener("click", function () {
        const id = getInput("editBacklogId");
        if (id) openMoveModal("backlog", id);
    });

    document.getElementById("backlogDetailMoveButton")?.addEventListener("click", function () {
        if (backlogDetailCurrentId) openMoveModal("backlog", backlogDetailCurrentId);
    });

    document.getElementById("moveOptions")?.addEventListener("change", function (event) {
        if (event.target.name === "moveTarget") selectMoveTarget(event.target.value);
    });

    document.getElementById("moveForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        submitMove();
    });

    const modal = document.getElementById("moveModal");
    modal?.addEventListener("click", function (event) {
        if (event.target === modal || event.target.closest("[data-close-move]")) closeMoveModal();
    });

});

/* =========================================================
   OPEN / CLOSE
========================================================= */

function findMoveSource(source, id) {
    if (source === "task") return tasks.find(function (t) { return t.taskId === id; }) || null;
    if (source === "regular") return findRegularTask(id) || null;
    if (source === "backlog") return backlogTasks.find(function (b) { return b.backlogId === id; }) || null;
    return null;
}

function openMoveModal(source, id, presetTarget) {

    if (!isPrivilegedUser()) return showNotification("Not allowed", "Only the Founder or Operations Head can move items.");

    const item = findMoveSource(source, id);
    if (!item) return showNotification("Can't move it", "That item isn't loaded any more. Press ↻ and try again.");

    // Close whatever opened this (task modal, drawer, regular / backlog modal)
    // so only one window is on screen.
    closeAllOverlays();

    moveContext = { source: source, id: id, item: item, target: "" };

    const kind = { task: "Task", regular: "Regular task", backlog: "Backlog item" }[source];
    setText("moveModalLabel", kind + " " + id);
    setText("moveModalTitle", source === "regular" ? "Move or copy" : "Move to another list");
    setText("moveModalSource", item.task || "(untitled)");

    const options = MOVE_OPTIONS[source];
    document.getElementById("moveOptions").innerHTML = options.map(function (o) {
        return `
            <label class="move-option">
                <input type="radio" name="moveTarget" value="${o.target}">
                <span class="move-option-body">
                    <strong>${escapeHtml(o.title)}</strong>
                    <span>${escapeHtml(o.text)}</span>
                </span>
            </label>
        `;
    }).join("");

    // Prefill every field from the item
    fillDepartmentSelect("moveDepartment", "Select Department");
    setInput("moveDepartment", item.department || "");
    setInput("moveFrequency", "");
    setInput("moveExpected", source === "task" ? displayDateForText(item.dueDate) : "");
    setInput("moveBacklogStatus", source === "regular" ? "Paused" : "Backlog");
    setInput("moveDueDate", source === "regular" ? (formatDateForInput(item.expectedDate) || todayInput()) : "");
    const copyBox = document.getElementById("moveCopyChecklist");
    if (copyBox) copyBox.checked = true;
    moveOwnerPicker?.setValue(source === "regular" ? item.assignedTo : "");

    showFormError("moveFormError", "");

    const first = presetTarget || (options.length === 1 ? options[0].target : "");
    selectMoveTarget(first);
    if (first) {
        const radio = document.querySelector(`#moveOptions input[value="${first}"]`);
        if (radio) radio.checked = true;
    }

    const modal = document.getElementById("moveModal");
    modal.style.display = "flex";
    document.body.classList.add("modal-open");

}

function closeMoveModal() {
    const modal = document.getElementById("moveModal");
    if (!modal || modal.style.display === "none") return;
    modal.style.display = "none";
    moveOwnerPicker?.close();
    const anyOpen = document.querySelector(".modal-overlay[style*='flex'], .detail-drawer[style*='block'], .regular-task-update-modal[style*='flex']");
    if (!anyOpen) document.body.classList.remove("modal-open");
    moveContext = null;
}

/* The backlog "expected" field is free text; show dates readably. */
function displayDateForText(value) {
    const date = parseDate(value);
    return date ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : String(value || "");
}

/* Shows only the fields the chosen destination needs. */
function selectMoveTarget(target) {

    if (!moveContext) return;
    moveContext.target = target;

    const source = moveContext.source;
    const show = {};

    if (source === "task" && target === "backlog") { show.backlogStatus = true; show.expected = true; }
    if (source === "task" && target === "regular") { show.frequency = true; }
    if (source === "regular" && target === "backlog") { show.backlogStatus = true; show.expected = true; }
    if (source === "regular" && target === "task") { show.department = true; show.owners = true; show.due = true; show.copyChecklist = true; }
    if (source === "backlog" && target === "task") { show.department = true; show.owners = true; show.due = true; }

    document.querySelectorAll("[data-move-field]").forEach(function (el) {
        el.hidden = !show[el.dataset.moveField];
    });

    const option = (MOVE_OPTIONS[source] || []).find(function (o) { return o.target === target; });
    const button = document.getElementById("moveConfirmButton");
    if (button) {
        button.textContent = option ? option.confirm : "Choose where it goes";
        button.disabled = !option;
    }

    const note = document.getElementById("moveModalNote");
    if (note) {
        let text = "";
        const item = moveContext.item;
        if (source === "task" && target === "regular" && item.description) {
            text = "Regular tasks don't have a description, so it's kept in the activity log.";
        } else if (source === "task" && target === "backlog") {
            const n = getChecklist(moveContext.id).length;
            if (n) text = n + " checklist item" + (n === 1 ? "" : "s") + " will be written into the backlog description.";
        } else if (source === "regular" && target === "task") {
            const n = getChecklist(moveContext.id).length;
            text = n ? "The copy starts with a fresh, unticked checklist." : "";
        }
        note.textContent = text;
        note.hidden = !text;
    }

    showFormError("moveFormError", "");
}

/* =========================================================
   SAVE
========================================================= */

async function submitMove() {

    if (!moveContext || isRequestActive("move")) return;

    const ctx = moveContext;
    const key = ctx.source + ">" + ctx.target;
    let action = "";
    let payload = {};

    if (!ctx.target) return showFormError("moveFormError", "Choose where it should go.");

    if (key === "task>backlog") {
        action = "moveTaskToBacklog";
        payload = { taskId: ctx.id, status: getInput("moveBacklogStatus"), expectedDate: getInput("moveExpected").trim() };
    }
    else if (key === "task>regular") {
        const frequency = getInput("moveFrequency").trim();
        if (!frequency) return showFormError("moveFormError", "Say how often it repeats, e.g. weekly.");
        action = "moveTaskToRegular";
        payload = { taskId: ctx.id, expectedTime: frequency };
    }
    else if (key === "regular>backlog") {
        action = "moveRegularToBacklog";
        payload = { regularTaskId: ctx.id, status: getInput("moveBacklogStatus"), expectedDate: getInput("moveExpected").trim() };
    }
    else if (key === "regular>task" || key === "backlog>task") {
        const department = getInput("moveDepartment");
        const owners = moveOwnerPicker ? moveOwnerPicker.getValue() : "";
        const due = getInput("moveDueDate");
        if (!department) return showFormError("moveFormError", "Choose a department.");
        if (!owners) return showFormError("moveFormError", "Choose at least one owner.");
        if (!due) return showFormError("moveFormError", "Pick a due date.");
        if (key === "regular>task") {
            action = "copyRegularToTask";
            payload = { regularTaskId: ctx.id, department: department, assignedTo: owners, dueDate: due,
                copyChecklist: !!document.getElementById("moveCopyChecklist")?.checked };
        } else {
            action = "moveBacklogToTaskV9";
            payload = { backlogId: ctx.id, department: department, assignedTo: owners, dueDate: due };
        }
    }

    if (!action) return showFormError("moveFormError", "That move isn't available.");
    showFormError("moveFormError", "");

    const button = document.getElementById("moveConfirmButton");
    setButtonLoading(button, true);

    let result = null;
    await guardAsync("move", async function () {
        showActionLoader(ctx.target === "task" && ctx.source === "regular" ? "Copying…" : "Moving…");
        result = await apiRequest(action, payload, { timeoutMs: 60000 });
    });

    setButtonLoading(button, false);

    if (!result || !result.success) {
        return showFormError("moveFormError", result?.message || "Couldn't move it. Press ↻ to check before trying again.");
    }

    applyMoveResult(ctx, result);
    closeMoveModal();

}

/* Updates the local lists so the change shows at once, without
   waiting for a full refresh from the sheet. */
function applyMoveResult(ctx, result) {

    const oldId = ctx.id;
    const newId = result.to?.id || "";
    const isCopy = !!result.copy;

    if (!isCopy) {
        if (ctx.source === "task") tasks = tasks.filter(function (t) { return t.taskId !== oldId; });
        if (ctx.source === "regular") {
            regularTasks = regularTasks.filter(function (r) { return r.regularTaskId !== oldId; });
            delete regularLatest[oldId];
        }
        if (ctx.source === "backlog") {
            const b = backlogTasks.find(function (x) { return x.backlogId === oldId; });
            if (b) b.status = "Moved to Active";
        }
        delete allChecklists[oldId];
        delete allComments[oldId];
    }

    if (newId) {
        if (Array.isArray(result.checklists) && result.checklists.length) allChecklists[newId] = result.checklists;
        if (Array.isArray(result.comments) && result.comments.length) allComments[newId] = result.comments;
    }

    if (result.item) backlogTasks.push(result.item);
    if (result.regularTask && canSeeItem(result.regularTask)) regularTasks.push(result.regularTask);

    lastSignature = "";
    populateRegularTasksDepartmentFilter();
    persistLocalCacheSoon();

    if (result.task) upsertLocalTask(result.task);   // also redraws
    else renderCurrentPage();

    const where = { task: "All Tasks", regular: "Regular Tasks", backlog: "the Backlog" }[result.to?.type] || "its new list";
    showNotification(isCopy ? "Copied" : "Moved",
        (isCopy ? "Copy of " + oldId + " created as " : oldId + " is now ") + newId + " in " + where + ".");

}
