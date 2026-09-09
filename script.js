/* =========================================================
   EXCELSO OPERATIONS MANAGEMENT SYSTEM
   FRONTEND JAVASCRIPT
========================================================= */

const API_URL =
    "https://script.google.com/macros/s/AKfycbyrOAQZ--7aDiAHv0ey60C8-xXuTKDAhOVDQjUOc-uiGdgNnpuJ97nL4m-ABkw0Znf3ig/exec";

const DEPARTMENTS = [
    "B2B - Sales",
    "Customer Support",
    "Warehouse",
    "Scanning - Catalog",
    "Listing - Inventory",
    "Digital Marketing",
    "IT - Software Development",
    "Finance",
    "Book Fair - Events",
    "Books and Supply Procurement",
    "HR",
    "Data Analysis",
    "Software Testing",
    "Product Development"
];

let tasks = [];
let regularTasks = [];
let currentDepartment = "";
let currentPage = "dashboard";
let editingTaskId = "";
let isSavingTask = false;
let currentUser = null;

/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    initializeDepartments();
    initializeDate();
    initializeNavigation();
    initializeTaskButtons();
    initializeFilters();
    initializeTaskForm();
    initializeLogout();
    initializeLogin();
    initializeRegularTaskUpdateForm();
    initializeExports();
    initializeSidebarToggle();
    checkLogin();
    initializePageLoader();

    initializeBacklog();
    initializeBookFair();
    initializeTaskDetailDrawer();

});

/* =========================================================
   PAGE LOADER
========================================================= */

function initializePageLoader() {

    const MIN_VISIBLE_MS = 1100;
    const start = Date.now();

    const hide = function () {

        const elapsed = Date.now() - start;
        const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

        setTimeout(function () {

            const loader = document.getElementById("pageLoader");

            if (loader) {

                loader.classList.add("loader-hidden");

                setTimeout(function () {
                    loader.style.display = "none";
                }, 650);
            }

        }, remaining);

    };

    if (document.readyState === "complete") {
        hide();
    } else {
        window.addEventListener("load", hide);
        setTimeout(hide, 2500);
    }

}

/* =========================================================
   LOGIN / AUTHENTICATION
========================================================= */

function initializeLogin() {

    const form = document.getElementById("loginForm");
    if (!form) return;

    form.addEventListener("submit", async function (event) {

        event.preventDefault();

        const username = document.getElementById("loginUsername")?.value?.trim() || "";
        const password = document.getElementById("loginPassword")?.value || "";
        const error = document.getElementById("loginError");
        const submitButton = form.querySelector(".login-button");

        if (error) {
            error.classList.remove("show");
            error.textContent = "";
        }

        if (!username || !password) {
            if (error) {
                error.textContent = "Please enter your username and password.";
                error.classList.add("show");
            }
            return;
        }

        setButtonLoading(submitButton, true);

        try {

            const result = await apiRequest("login", { username: username, password: password });

            console.log("LOGIN RESPONSE:", result);

            if (!result || !result.success || !result.user) {

                if (error) {
                    error.textContent = result?.message || "Invalid username or password.";
                    error.classList.add("show");
                }

                setButtonLoading(submitButton, false);
                return;
            }

            currentUser = result.user;

            sessionStorage.setItem("usedbookrCurrentUser", JSON.stringify(currentUser));
            sessionStorage.setItem("usedbookrOperationsLogin", "true");

            hideLogin();
            updateLoggedInUserProfile();

            await loadTasks();
            await loadRegularTasks();
            await loadAllChecklists();
            await loadAllComments();
            await loadBacklogTasks();

            applyUserAccess();

        }
        catch (err) {

            console.error("LOGIN ERROR:", err);

            if (error) {
                error.textContent = "Unable to connect to the authentication server.";
                error.classList.add("show");
            }

        }
        finally {
            setButtonLoading(submitButton, false);
        }

    });

}

function setButtonLoading(button, isLoading) {

    if (!button) return;

    if (isLoading) {
        button.classList.add("is-loading");
        button.disabled = true;
    } else {
        button.classList.remove("is-loading");
        button.disabled = false;
    }

}

/* =========================================================
   CHECK LOGIN
========================================================= */

function checkLogin() {

    const loggedIn = sessionStorage.getItem("usedbookrOperationsLogin");
    const savedUser = sessionStorage.getItem("usedbookrCurrentUser");

    if (loggedIn === "true" && savedUser) {

        try {

            currentUser = JSON.parse(savedUser);

            hideLogin();
            updateLoggedInUserProfile();
            loadTasks();
            loadRegularTasks();
            loadAllChecklists();
            loadAllComments();
            loadBacklogTasks();
            applyUserAccess();

        }
        catch (error) {
            console.error("SESSION RESTORE ERROR:", error);
            logoutUser();
        }

    } else {
        showLogin();
    }

}

/* =========================================================
   HIDE / SHOW LOGIN
========================================================= */

function hideLogin() {

    const login = document.getElementById("loginScreen");
    const app = document.getElementById("app");

    if (login) login.style.display = "none";
    if (app) app.style.display = "flex";

}

function showLogin() {

    const login = document.getElementById("loginScreen");
    const app = document.getElementById("app");

    if (login) login.style.display = "flex";
    if (app) app.style.display = "none";

}

/* =========================================================
   UPDATE LOGGED-IN USER PROFILE
========================================================= */

function updateLoggedInUserProfile() {

    if (!currentUser) {
        console.warn("No current user available for profile display.");
        return;
    }

    const avatar = document.getElementById("loggedUserAvatar");
    const nameElement = document.getElementById("loggedUserName");
    const roleElement = document.getElementById("loggedUserRole");

    const name = String(currentUser.name || "").trim();
    const role = String(currentUser.role || "").trim();
    const username = String(currentUser.username || "").trim();

    if (nameElement) nameElement.textContent = name || username || "User";
    if (roleElement) roleElement.textContent = role || "User";

    let initials = "";

    if (name) {

        const words = name.replace(/\./g, " ").split(/\s+/).filter(function(word) { return word.length > 0; });

        if (words.length >= 2) {
            initials = words[0].charAt(0) + words[words.length - 1].charAt(0);
        } else {
            initials = words[0].substring(0, 2);
        }

    }

    if (!initials) initials = username.substring(0, 2);

    if (avatar) avatar.textContent = initials.toUpperCase();

}

/* =========================================================
   LOGOUT
========================================================= */

function initializeLogout() {

    const button = document.getElementById("logoutButton");
    if (!button) return;

    button.addEventListener("click", function () { logoutUser(); });

}

function logoutUser() {

    currentUser = null;

    sessionStorage.removeItem("usedbookrOperationsLogin");
    sessionStorage.removeItem("usedbookrCurrentUser");

    showLogin();

    const username = document.getElementById("loginUsername");
    const password = document.getElementById("loginPassword");

    if (username) username.value = "";
    if (password) password.value = "";

}

/* =========================================================
   USER ACCESS
========================================================= */

function applyUserAccess() {
    if (!currentUser) return;
    console.log("AUTHENTICATED USER:", currentUser);
}

/* =========================================================
   DEPARTMENTS (dropdowns + cards)
========================================================= */

function initializeDepartments() {

    const select = document.getElementById("taskDepartment");
    const filter = document.getElementById("departmentFilter");

    if (select) {

        select.innerHTML = '<option value="">Select Department</option>';

        DEPARTMENTS.forEach(function (department) {
            const option = document.createElement("option");
            option.value = department;
            option.textContent = department;
            select.appendChild(option);
        });

    }

    if (filter) {

        filter.innerHTML = '<option value="">All Departments</option>';

        DEPARTMENTS.forEach(function (department) {
            const option = document.createElement("option");
            option.value = department;
            option.textContent = department;
            filter.appendChild(option);
        });

    }

    const backlogSelect = document.getElementById("backlogDepartment");

    if (backlogSelect) {

        backlogSelect.innerHTML = '<option value="">Unassigned</option>';

        DEPARTMENTS.forEach(function (department) {
            const option = document.createElement("option");
            option.value = department;
            option.textContent = department;
            backlogSelect.appendChild(option);
        });

    }

    renderDepartmentCards();

}

/* =========================================================
   DATE
========================================================= */

function initializeDate() {

    const element = document.getElementById("currentDate");
    if (!element) return;

    element.textContent = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

}

/* =========================================================
   NAVIGATION
========================================================= */

function initializeNavigation() {

    document.querySelectorAll(".nav-item").forEach(function (item) {

        item.addEventListener("click", function () {

            const page = item.dataset.page;
            const department = item.dataset.department;

            if (department) {
                openDepartment(department);
                closeSidebarOnMobile();
                return;
            }

            if (page) {
                showPage(page);
                closeSidebarOnMobile();
            }

        });

    });

    const menu = document.getElementById("menuToggle");

    if (menu) {
        menu.addEventListener("click", function () { toggleSidebar(); });
    }

}

/* =========================================================
   MOBILE SIDEBAR TOGGLE
========================================================= */

function initializeSidebarToggle() {

    const backdrop = document.getElementById("sidebarBackdrop");

    if (backdrop) {
        backdrop.addEventListener("click", closeSidebarOnMobile);
    }

}

function toggleSidebar() {

    const sidebar = document.querySelector(".sidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    const menu = document.getElementById("menuToggle");

    if (!sidebar) return;

    const isOpen = sidebar.classList.toggle("sidebar-open");

    if (backdrop) backdrop.classList.toggle("show", isOpen);
    if (menu) menu.classList.toggle("is-open", isOpen);

}

function closeSidebarOnMobile() {

    const sidebar = document.querySelector(".sidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    const menu = document.getElementById("menuToggle");

    if (sidebar) sidebar.classList.remove("sidebar-open");
    if (backdrop) backdrop.classList.remove("show");
    if (menu) menu.classList.remove("is-open");

}

function showPage(page) {

    currentPage = page;

    document.querySelectorAll(".page").forEach(function (section) {
        section.classList.remove("active-page");
    });

    const target = document.getElementById(page + "Page");
    if (target) target.classList.add("active-page");

    document.querySelectorAll(".nav-item").forEach(function (item) {
        item.classList.remove("active");
        if (item.dataset.page === page) item.classList.add("active");
    });

    updatePageHeader(page);

    if (page === "dashboard") updateDashboard();
    if (page === "tasks") renderTasksTable();
    if (page === "regularTasks") renderRegularTasks();
    if (page === "followups") renderFollowups();
    if (page === "activity") renderActivity();
    if (page === "backlog") renderBacklog();
    if (page === "bookFair") renderBookFair();

}

function updatePageHeader(page) {

    const title = document.getElementById("pageTitle");
    const subtitle = document.getElementById("pageSubtitle");

    const names = {
        dashboard: ["Operations Dashboard", "Centralized operational monitoring"],
        tasks: ["All Tasks", "Manage tasks across all departments"],
        regularTasks: ["Regular Tasks", "Complete and update your recurring operational tasks"],
        followups: ["Follow-ups", "Monitor commitments and pending actions"],
        activity: ["Activity Log", "Track operational changes"],
        backlog: ["Backlog", "Future and paused tasks parked for later"],
        bookFair: ["Book Fair", "Priority tasks and checklists for Book Fair / Events"],
    };

    if (names[page]) {
        if (title) title.textContent = names[page][0];
        if (subtitle) subtitle.textContent = names[page][1];
    }

}

/* =========================================================
   API
========================================================= */

async function apiRequest(action, data = {}) {

    try {

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: action, ...data })
        });

        if (!response.ok) throw new Error("HTTP " + response.status);

        const result = await response.json();
        return result;

    }
    catch (error) {

        console.error("API Error:", error);
        showNotification("Connection Error", "Unable to connect to Google Sheets.");

        return { success: false, message: error.message };

    }

}

/* =========================================================
   FILTER TASKS FOR CURRENT USER
========================================================= */

function filterTasksForCurrentUser(allTasks) {

    if (!currentUser) {
        console.warn("No authenticated user found.");
        return [];
    }

    const role = String(currentUser.role || "").trim().toLowerCase();
    const username = String(currentUser.username || "").trim().toLowerCase();
    const name = String(currentUser.name || "").trim().toLowerCase();

    if (role === "founder") return allTasks;
    if (role === "operations head") return allTasks;

    const allowedDepartments = getAllowedDepartments();

    return allTasks.filter(function(task) {

        const department = String(task.department || "").trim();
        const assignedTo = String(task.assignedTo || "").trim().toLowerCase();

        if (allowedDepartments.includes(department)) return true;
        if (assignedTo === username || assignedTo === name) return true;

        return false;

    });

}

/* =========================================================
   GET ALLOWED DEPARTMENTS
========================================================= */

function getAllowedDepartments() {

    if (!currentUser) return [];

    const departments = [];

    const primary = String(currentUser.primaryDepartment || "").trim();

    if (primary && primary.toLowerCase() !== "all") {
        departments.push(primary);
    }

    const coordination = String(currentUser.coordinationDepartments || "").trim();

    if (coordination) {

        if (coordination.toLowerCase() === "all") {
            return DEPARTMENTS.slice();
        }

        coordination
            .split(",")
            .map(function(department) { return department.trim(); })
            .filter(function(department) { return department !== ""; })
            .forEach(function(department) {
                if (!departments.includes(department)) departments.push(department);
            });

    }

    return departments;

}
/* =========================================================
   REQUEST GUARD + MASCOT LOADER
   Prevents duplicate submissions (double-clicks / slow network)
   and shows a small "Saving…" mascot while any write request
   is in flight.
========================================================= */

const activeRequests = new Set();

function isRequestActive(key) {
    return activeRequests.has(key);
}

async function guardAsync(key, fn) {

    if (activeRequests.has(key)) return;

    activeRequests.add(key);
    showActionLoader();

    try {
        return await fn();
    }
    catch (error) {
        console.error("Guarded request failed:", key, error);
        throw error;
    }
    finally {
        activeRequests.delete(key);
        if (activeRequests.size === 0) hideActionLoader();
    }

}

function showActionLoader(text) {

    const loader = document.getElementById("actionLoader");
    if (!loader) return;

    const label = document.getElementById("actionLoaderText");
    if (label) label.textContent = text || "Saving…";

    loader.classList.add("show");

}

function hideActionLoader() {

    const loader = document.getElementById("actionLoader");
    if (loader) loader.classList.remove("show");

}
/* =========================================================
   NORMALIZE API DATA
========================================================= */

function normalizeTasks(data) {

    if (!Array.isArray(data)) return [];

    return data.map(function (task) {

        return {

            taskId: task.taskId ?? task["Task ID"] ?? "",
            task: task.task ?? task["Task"] ?? "",
            description: task.description ?? task["Description"] ?? "",
            department: task.department ?? task["Department"] ?? "",
            assignedTo: task.assignedTo ?? task["Assigned To"] ?? "",
            priority: task.priority ?? task["Priority"] ?? "Medium",
            status: task.status ?? task["Status"] ?? "Open",
            createdDate: formatDateForInput(task.createdDate ?? task["Created Date"] ?? ""),
            dueDate: formatDateForInput(task.dueDate ?? task["Due Date"] ?? ""),
            followupDate: formatDateForInput(task.followupDate ?? task["Follow-up Date"] ?? ""),
            lastAction: task.lastAction ?? task["Last Action"] ?? task["Last Action / Follow-up"] ?? "",
            remarks: task.remarks ?? task["Remarks"] ?? "",
            updatedBy: task.updatedBy ?? task["Updated By"] ?? "",
            updatedDate: formatDateForInput(task.updatedDate ?? task["Updated Date"] ?? "")

        };

    });

}

/* =========================================================
   LOAD TASKS
========================================================= */

async function loadTasks() {

    const result = await apiRequest("getTasks");

    if (result && result.success) {
        const normalized = normalizeTasks(result.tasks || result.data || []);
        tasks = filterTasksForCurrentUser(normalized);
    } else {
        tasks = [];
    }

    updateAllViews();

}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

/* =========================================================
   LOAD REGULAR TASKS
========================================================= */

async function loadRegularTasks() {

    const container = document.getElementById("regularTasksContainer");

    try {

        if (container) {
            container.innerHTML = `<div class="regular-tasks-loading">Loading regular tasks...</div>`;
        }

        const response = await fetch(API_URL + "?action=getRegularTasks");
        const result = await response.json();

        console.log("REGULAR TASKS API RESPONSE:", result);

        if (!result || !result.success) {

            regularTasks = [];

            if (container) {
                container.innerHTML = `
                    <div class="regular-tasks-empty">
                        Unable to load regular tasks.
                        ${result?.message ? escapeHtml(result.message) : ""}
                    </div>
                `;
            }

            return;

        }

        regularTasks = Array.isArray(result.regularTasks) ? result.regularTasks : [];

        console.log("REGULAR TASKS LOADED:", regularTasks.length, regularTasks);

        renderRegularTasks();

    }
    catch (error) {

        console.error("REGULAR TASKS ERROR:", error);

        regularTasks = [];

        if (container) {
            container.innerHTML = `<div class="regular-tasks-empty">Unable to load regular tasks. Please try again.</div>`;
        }

    }

}

/* =========================================================
   RENDER REGULAR TASKS
========================================================= */

function renderRegularTasks() {

    const container = document.getElementById("regularTasksContainer");

    if (!container) {
        console.warn("Regular Tasks container not found.");
        return;
    }

    if (!Array.isArray(regularTasks) || regularTasks.length === 0) {
        container.innerHTML = `<div class="regular-tasks-empty">No regular tasks found.</div>`;
        return;
    }

    const groups = {};

    regularTasks.forEach(function(task) {

        const frequency = String(task.expectedTime || "Other").trim().toLowerCase();

        let groupName = "Other";

        if (frequency === "daily") groupName = "Daily";
        else if (frequency === "weekly") groupName = "Weekly";
        else if (frequency === "twice a week" || frequency === "twice-a-week" || frequency === "twice_a_week") groupName = "Twice a Week";
        else if (frequency === "monthly") groupName = "Monthly";

        if (!groups[groupName]) groups[groupName] = [];

        groups[groupName].push(task);

    });

    const displayOrder = ["Daily", "Weekly", "Twice a Week", "Monthly", "Other"];

    let html = "";

    displayOrder.forEach(function(groupName) {

        const group = groups[groupName];

        if (!group || group.length === 0) return;

        html += `
            <div class="regular-task-group">
                <div class="regular-task-group-header">
                    <h2>${escapeHtml(groupName)}</h2>
                    <span>${group.length} task${group.length === 1 ? "" : "s"}</span>
                </div>
                <div class="regular-task-list">
        `;

        const orderedGroup = sortMineFirst(group, function(task) { return task.assignedTo; });

        orderedGroup.forEach(function(task) {
            html += createRegularTaskCard(task);
        });

        html += `</div></div>`;

    });

    container.innerHTML = html;

}

/* =========================================================
   OPEN / CLOSE REGULAR TASK UPDATE
========================================================= */

function openRegularTaskUpdate(regularTaskId) {

    const task = regularTasks.find(function(item) {
        return String(item.regularTaskId || "").trim() === String(regularTaskId || "").trim();
    });

    if (!task) {
        showNotification("Error", "Regular task could not be found.");
        return;
    }

    const modal = document.getElementById("regularTaskUpdateModal");

    if (!modal) {
        console.error("Regular Task Update modal not found.");
        return;
    }

    const taskName = document.getElementById("regularTaskUpdateTaskName");
    const taskId = document.getElementById("regularTaskUpdateTaskId");
    const department = document.getElementById("regularTaskUpdateDepartment");
    const expectedTime = document.getElementById("regularTaskUpdateExpectedTime");

    if (taskName) taskName.textContent = task.task || "Regular Task";
    if (taskId) taskId.textContent = task.regularTaskId || "-";
    if (department) department.textContent = task.department || "-";
    if (expectedTime) expectedTime.textContent = task.expectedTime || "-";

    const form = document.getElementById("regularTaskUpdateForm");
    if (form) form.dataset.regularTaskId = task.regularTaskId || "";

    const status = document.getElementById("regularTaskStatus");
    const description = document.getElementById("regularTaskDescription");
    const error = document.getElementById("regularTaskUpdateError");

    if (status) status.value = "";
    if (description) description.value = "";

    if (error) {
        error.textContent = "";
        error.style.display = "none";
    }

    modal.style.display = "flex";
    document.body.classList.add("modal-open");

}

function closeRegularTaskUpdate() {

    const modal = document.getElementById("regularTaskUpdateModal");
    if (modal) modal.style.display = "none";

    document.body.classList.remove("modal-open");

}

/* =========================================================
   INITIALIZE REGULAR TASK UPDATE FORM
========================================================= */

function initializeRegularTaskUpdateForm() {

    const form = document.getElementById("regularTaskUpdateForm");
    if (!form) return;

    if (form.dataset.initialized === "true") return;
    form.dataset.initialized = "true";

    form.addEventListener("submit", async function(event) {

        event.preventDefault();

        const regularTaskId = String(form.dataset.regularTaskId || "").trim();
        const status = document.getElementById("regularTaskStatus")?.value || "";
        const description = document.getElementById("regularTaskDescription")?.value.trim() || "";
        const error = document.getElementById("regularTaskUpdateError");

        if (!regularTaskId) {
            if (error) { error.textContent = "Regular Task ID is missing."; error.style.display = "block"; }
            return;
        }

        if (status !== "Completed" && status !== "Pending") {
            if (error) { error.textContent = "Please select Completed or Pending."; error.style.display = "block"; }
            return;
        }

        if (!description) {
            if (error) { error.textContent = "Please enter a description."; error.style.display = "block"; }
            return;
        }

        const button = document.getElementById("saveRegularTaskUpdateButton");

        if (button) { button.disabled = true; button.textContent = "Saving..."; }

        try {

            const result = await apiRequest("saveRegularTaskUpdate", {
                regularTaskId: regularTaskId,
                status: status,
                description: description,
                updatedBy: currentUser?.username || currentUser?.name || "Website"
            });

            if (!result || !result.success) {
                throw new Error(result?.message || "Unable to save update.");
            }

            closeRegularTaskUpdate();
            showNotification("Updated", "Regular task update saved successfully.");

            await loadRegularTasks();

        }
        catch (submitError) {

            console.error("Regular task update error:", submitError);

            if (error) {
                error.textContent = submitError.message || "Unable to save update.";
                error.style.display = "block";
            }

        }
        finally {

            if (button) {
                button.disabled = false;
                button.textContent = "Save Update";
            }

        }

    });

}

/* =========================================================
   CREATE REGULAR TASK CARD
========================================================= */

function createRegularTaskCard(task) {

    const id = String(task.regularTaskId || "").trim();
    const department = String(task.department || "").trim();
    const taskName = String(task.task || "").trim();
    const assignedTo = String(task.assignedTo || "").trim();
    const priority = String(task.priority || "").trim();
    const expectedTime = String(task.expectedTime || "").trim();
    const expectedDate = String(task.expectedDate || "").trim();

    return `
        <div class="regular-task-card" data-regular-task-id="${escapeHtml(id)}">
            <div class="regular-task-card-main">
                <div class="regular-task-id">${escapeHtml(id)}</div>
                <h3>${escapeHtml(taskName)}</h3>
                <div class="regular-task-details">
                    ${department ? `<span>Department: ${escapeHtml(department)}</span>` : ""}
                    ${assignedTo ? `<span>Assigned To: ${escapeHtml(assignedTo)}</span>` : ""}
                    ${priority ? `<span>Priority: ${escapeHtml(priority)}</span>` : ""}
                    ${expectedTime ? `<span>Expected: ${escapeHtml(expectedTime)}</span>` : ""}
                    ${expectedDate ? `<span>Expected Date: ${escapeHtml(expectedDate)}</span>` : ""}
                </div>
            </div>
            <button type="button" class="regular-task-update-button" onclick="openRegularTaskUpdate('${escapeHtml(id)}')">Update</button>
        </div>
    `;

}

/* =========================================================
   UPDATE ALL VIEWS
========================================================= */

function updateAllViews() {

    updateDashboard();
    renderTasksTable();
    renderFollowups();
    renderActivity();
    renderDepartmentCards();

}

/* =========================================================
   DASHBOARD
========================================================= */

function updateDashboard() {

    const total = tasks.length;
    const open = tasks.filter(function(t) { return t.status === "Open"; }).length;
    const progress = tasks.filter(function(t) { return t.status === "In Progress"; }).length;
    const blocked = tasks.filter(function(t) { return t.status === "Blocked"; }).length;
    const completed = tasks.filter(function(t) { return t.status === "Completed"; }).length;
    const overdue = tasks.filter(isOverdue).length;

    animateNumber("totalTasks", total);
    animateNumber("openTasks", open);
    animateNumber("progressTasks", progress);
    animateNumber("blockedTasks", blocked);
    animateNumber("completedTasks", completed);
    animateNumber("overdueTasks", overdue);

    animateNumber("highPriorityCount", tasks.filter(function(t) { return t.priority === "High"; }).length);
    animateNumber("mediumPriorityCount", tasks.filter(function(t) { return t.priority === "Medium"; }).length);
    animateNumber("lowPriorityCount", tasks.filter(function(t) { return t.priority === "Low"; }).length);

    updateFollowupSummary();
    renderRecentTasks();

}

/* count-up animation for KPI / summary numbers (purely cosmetic) */
function animateNumber(id, value) {

    const element = document.getElementById(id);
    if (!element) return;

    const target = Number(value) || 0;
    const start = Number(element.textContent) || 0;

    if (start === target) {
        element.textContent = target;
        return;
    }

    const duration = 500;
    const startTime = performance.now();

    function tick(now) {

        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * eased);

        element.textContent = current;

        if (progress < 1) {
            requestAnimationFrame(tick);
        } else {
            element.textContent = target;
        }

    }

    requestAnimationFrame(tick);

}

/* =========================================================
   RECENT TASKS
========================================================= */

function renderRecentTasks() {

    const tbody = document.getElementById("recentTasksTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    const recent = [...tasks]
        .sort(function(a, b) { return String(b.updatedDate).localeCompare(String(a.updatedDate)); })
        .slice(0, 10);

    if (!recent.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">No tasks available.</td></tr>`;
        return;
    }

    recent.forEach(function(task) {

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td>${escapeHTML(task.task)}</td>
            <td>${escapeHTML(task.department)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${displayDate(task.dueDate)}</td>
        `;

        tbody.appendChild(row);

    });

}

/* =========================================================
   ALL TASKS
========================================================= */

function renderTasksTable() {

    const tbody = document.getElementById("allTasksTable");
    if (!tbody) return;

    const search = document.getElementById("taskSearch")?.value?.toLowerCase() || "";
    const department = document.getElementById("departmentFilter")?.value || "";
    const priority = document.getElementById("priorityFilter")?.value || "";
    const status = document.getElementById("statusFilter")?.value || "";

    const filtered = tasks.filter(function(task) {

        const text = (task.task + " " + task.description + " " + task.assignedTo + " " + task.department + " " + task.taskId).toLowerCase();

        if (search && !text.includes(search)) return false;
        if (department && task.department !== department) return false;
        if (priority && task.priority !== priority) return false;

        if (status === "Overdue") return isOverdue(task);
        if (status && task.status !== status) return false;

        return true;

    });

    const ordered = sortMineFirst(filtered, function(task) { return task.assignedTo; });

    tbody.innerHTML = "";

    if (!ordered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-table">No matching tasks available.</td></tr>`;
        return;
    }

    ordered.forEach(function(task) {

        const row = document.createElement("tr");
        row.className = "row-clickable";
        row.dataset.id = task.taskId;

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td><strong>${escapeHTML(task.task)}</strong></td>
            <td>${escapeHTML(task.department)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${displayDate(task.dueDate)}</td>
            <td class="checklist-cell">${checklistStatusDot("task:" + task.taskId)}</td>
            <td>${isPrivilegedUser() ? `<button class="table-action edit-task" data-id="${escapeHTML(task.taskId)}">Edit</button>` : `<span class="table-action-view">View</span>`}</td>
        `;

        row.addEventListener("click", function(event) {
            if (event.target.closest(".edit-task")) return;
            openTaskDetailDrawer(task.taskId);
        });

        tbody.appendChild(row);

    });

    tbody.querySelectorAll(".edit-task").forEach(function(button) {
        button.addEventListener("click", function(event) {
            event.stopPropagation();
            editTask(button.dataset.id);
        });
    });

}

/* =========================================================
   FOLLOWUPS
========================================================= */

function updateFollowupSummary() {

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = tasks.filter(function(task) {
        return task.followupDate && sameDate(task.followupDate, today);
    }).length;

    const overdue = tasks.filter(function(task) {
        return task.followupDate && dateBeforeToday(task.followupDate);
    }).length;

    const upcoming = tasks.filter(function(task) {
        if (!task.followupDate) return false;
        const date = parseDate(task.followupDate);
        return date && date > today;
    }).length;

    animateNumber("followupsToday", todayCount);
    animateNumber("followupsOverdue", overdue);
    animateNumber("followupsUpcoming", upcoming);

    animateNumber("followupPageToday", todayCount);
    animateNumber("followupPageOverdue", overdue);
    animateNumber("followupPageUpcoming", upcoming);

}

function renderFollowups() {

    const tbody = document.getElementById("followupsTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    const followups = tasks
        .filter(function(t) { return t.followupDate; })
        .sort(function(a,b) { return String(a.followupDate).localeCompare(String(b.followupDate)); });

    if (!followups.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">No follow-ups available.</td></tr>`;
        return;
    }

    followups.forEach(function(task) {

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td>${escapeHTML(task.task)}</td>
            <td>${escapeHTML(task.department)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${displayDate(task.followupDate)}</td>
            <td>${escapeHTML(task.lastAction || "-")}</td>
            <td>${statusBadge(task.status, task)}</td>
        `;

        tbody.appendChild(row);

    });

}

/* =========================================================
   DEPARTMENTS
========================================================= */

function openDepartment(department) {
    currentDepartment = department;
    showDepartmentPage(department);
}

function showDepartmentPage(department) {

    currentDepartment = department;

    document.querySelectorAll(".page").forEach(function(section) {
        section.classList.remove("active-page");
    });

    const page = document.getElementById("departmentDetailPage");
    if (page) page.classList.add("active-page");

    setText("departmentDetailCode", getDepartmentCode(department));
    setText("departmentDetailTitle", department);
    setText("departmentDetailSubtitle", "Department operational overview.");

    const departmentTasks = tasks.filter(function(task) { return task.department === department; });

    setText("departmentTotal", departmentTasks.length);
    setText("departmentOpen", departmentTasks.filter(function(t) { return t.status === "Open"; }).length);
    setText("departmentProgress", departmentTasks.filter(function(t) { return t.status === "In Progress"; }).length);
    setText("departmentBlocked", departmentTasks.filter(function(t) { return t.status === "Blocked"; }).length);
    setText("departmentCompleted", departmentTasks.filter(function(t) { return t.status === "Completed"; }).length);
    setText("departmentOverdue", departmentTasks.filter(isOverdue).length);

    renderDepartmentTasks(departmentTasks);

}

function renderDepartmentTasks(departmentTasks) {

    const tbody = document.getElementById("departmentTasksTable");
    if (!tbody) return;

    const ordered = sortMineFirst(departmentTasks, function(task) { return task.assignedTo; });

    tbody.innerHTML = "";

    if (!ordered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-table">No department tasks available.</td></tr>`;
        return;
    }

    ordered.forEach(function(task) {

        const row = document.createElement("tr");
        row.className = "row-clickable";

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td>${escapeHTML(task.task)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${displayDate(task.dueDate)}</td>
            <td>${displayDate(task.followupDate)}</td>
            <td class="checklist-cell">${checklistStatusDot("task:" + task.taskId)}</td>
            <td>${isPrivilegedUser() ? `<button class="table-action edit-department-task" data-id="${escapeHTML(task.taskId)}">Edit</button>` : `<span class="table-action-view">View</span>`}</td>
        `;

        row.addEventListener("click", function(event) {
            if (event.target.closest(".edit-department-task")) return;
            openTaskDetailDrawer(task.taskId);
        });

        tbody.appendChild(row);

    });

    tbody.querySelectorAll(".edit-department-task").forEach(function(button) {
        button.addEventListener("click", function(event) {
            event.stopPropagation();
            editTask(button.dataset.id);
        });
    });

}

/* =========================================================
   DEPARTMENT CARDS
========================================================= */

function renderDepartmentCards() {

    const container = document.getElementById("departmentsGrid");
    if (!container) return;

    container.innerHTML = "";

    DEPARTMENTS.forEach(function (department) {

        const departmentTasks = tasks.filter(function(task) { return task.department === department; });

        const completed = departmentTasks.filter(function(task) { return task.status === "Completed"; }).length;
        const blocked = departmentTasks.filter(function(task) { return task.status === "Blocked"; }).length;
        const overdue = departmentTasks.filter(isOverdue).length;

        const card = document.createElement("div");
        card.className = "department-card";

        card.innerHTML = `
            <div class="department-card-code">${getDepartmentCode(department)}</div>
            <h3>${escapeHTML(department)}</h3>
            <div class="department-card-stats">
                <div><strong>${departmentTasks.length}</strong><span>Total</span></div>
                <div><strong>${completed}</strong><span>Completed</span></div>
                <div><strong>${blocked}</strong><span>Blocked</span></div>
                <div><strong>${overdue}</strong><span>Overdue</span></div>
            </div>
            <button class="secondary-button department-view-button">View Department</button>
        `;

        card.querySelector("button").addEventListener("click", function() {
            openDepartment(department);
        });

        container.appendChild(card);

    });

}

/* =========================================================
   ACTIVITY
========================================================= */

function renderActivity() {

    const container = document.getElementById("activityTimeline");
    if (!container) return;

    if (!tasks.length) {
        container.innerHTML = `<div class="empty-state">No activity recorded yet.</div>`;
        return;
    }

    const activities = [...tasks]
        .sort(function(a,b) { return String(b.updatedDate).localeCompare(String(a.updatedDate)); })
        .slice(0, 20);

    container.innerHTML = "";

    activities.forEach(function(task) {

        const item = document.createElement("div");
        item.className = "activity-item";

        item.innerHTML = `
            <div class="activity-dot"></div>
            <div class="activity-content">
                <strong>${escapeHTML(task.task)}</strong>
                <p>${escapeHTML(task.status)} · ${escapeHTML(task.department)}</p>
                <small>Updated by ${escapeHTML(task.updatedBy || "System")} · ${escapeHTML(displayDate(task.updatedDate))}</small>
            </div>
        `;

        container.appendChild(item);

    });

}

/* =========================================================
   TASK BUTTONS
========================================================= */

function initializeTaskButtons() {

    ["topAddTask", "dashboardAddTask", "tasksAddButton", "departmentAddTaskButton"].forEach(function(id) {

        const button = document.getElementById(id);
        if (!button) return;

        button.addEventListener("click", function() { openTaskModal(); });

    });

    const close = document.getElementById("closeTaskModal");
    const cancel = document.getElementById("cancelTaskButton");

    if (close) close.addEventListener("click", closeTaskModal);
    if (cancel) cancel.addEventListener("click", closeTaskModal);

    const overlay = document.getElementById("taskModal");

    if (overlay) {
        overlay.addEventListener("click", function(event) {
            if (event.target === overlay) closeTaskModal();
        });
    }

    document.addEventListener("keydown", function(event) {
        if (event.key === "Escape") closeTaskModal();
    });

}

/* =========================================================
   TASK FORM
========================================================= */

function initializeTaskForm() {

    const form = document.getElementById("taskForm");
    if (!form) return;

    form.addEventListener("submit", async function(event) {
        event.preventDefault();
        await saveTask();
    });

}

function openTaskModal(task = null) {

    const modal = document.getElementById("taskModal");
    if (!modal) return;

    modal.style.display = "flex";

    const title = document.getElementById("taskModalTitle");

    if (task) {

        editingTaskId = task.taskId;

        if (title) title.textContent = "Edit Task";

        populateTaskForm(task);

    } else {

        editingTaskId = "";

        if (title) title.textContent = "Add New Task";

        clearTaskForm();

        if (currentDepartment) {
            setInput("taskDepartment", currentDepartment);
        }

    }

}

function closeTaskModal() {

    const modal = document.getElementById("taskModal");
    if (modal) modal.style.display = "none";

    editingTaskId = "";

}

function clearTaskForm() {

    const form = document.getElementById("taskForm");
    if (form) form.reset();

    setInput("editTaskId", "");
    setInput("taskPriority", "Medium");
    setInput("taskStatus", "Open");

}

function populateTaskForm(task) {

    setInput("editTaskId", task.taskId);
    setInput("taskName", task.task);
    setInput("taskDepartment", task.department);
    setInput("taskAssignedTo", task.assignedTo);
    setInput("taskPriority", task.priority);
    setInput("taskStatus", task.status);
    setInput("taskCreatedDate", task.createdDate);
    setInput("taskDueDate", task.dueDate);
    setInput("taskFollowupDate", task.followupDate);
    setInput("taskFollowupAction", task.lastAction);
    setInput("taskRemarks", task.remarks);

}

/* =========================================================
   SAVE TASK
========================================================= */

async function saveTask() {

    if (isRequestActive("saveTask")) return;

    const submitButton = document.querySelector("#taskForm .primary-button");
    setButtonLoading(submitButton, true);

    await guardAsync("saveTask", saveTaskRequest);

    setButtonLoading(submitButton, false);

}

async function saveTaskRequest() {

    const editId = getInput("editTaskId");

    const task = {

        taskId: editId,
        task: getInput("taskName"),
        description: getInput("taskDescription"),
        department: getInput("taskDepartment"),
        assignedTo: getInput("taskAssignedTo"),
        priority: getInput("taskPriority") || "Medium",
        status: getInput("taskStatus") || "Open",
        createdDate: getInput("taskCreatedDate") || todayInput(),
        dueDate: getInput("taskDueDate"),
        followupDate: getInput("taskFollowupDate"),
        lastAction: getInput("taskFollowupAction"),
        remarks: getInput("taskRemarks"),
        updatedBy: currentUser?.name || currentUser?.username || "Operations Head"

    };

    if (!task.task) {
        showNotification("Missing Information", "Please enter a task.");
        return;
    }

    let result;

    if (editId) {
        result = await apiRequest("updateTask", { task: task });
    } else {
        result = await apiRequest("createTask", { task: task });
    }

    if (!result || !result.success) {
        showNotification("Error", result?.message || "Unable to save task.");
        return;
    }

    closeTaskModal();
    showNotification("Saved", "Task saved successfully.");

    await loadTasks();

}

function editTask(taskId) {

    const task = tasks.find(function(t) { return t.taskId === taskId; });

    if (!task) {
        showNotification("Error", "Task not found.");
        return;
    }

    openTaskModal(task);

}

/* =========================================================
   FILTERS
========================================================= */

function initializeFilters() {

    ["taskSearch", "departmentFilter", "priorityFilter", "statusFilter"].forEach(function(id) {

        const element = document.getElementById(id);
        if (!element) return;

        element.addEventListener("input", renderTasksTable);
        element.addEventListener("change", renderTasksTable);

    });

}

/* =========================================================
   EXPORT
========================================================= */

function initializeExports() {

    const button = document.getElementById("exportTasksButton");

    if (button) {
        button.addEventListener("click", exportTasksCSV);
    }

}

function exportTasksCSV() {

    if (!tasks.length) {
        showNotification("Export", "There are no tasks to export.");
        return;
    }

    const headers = [
        "Task ID", "Department", "Task", "Description", "Assigned To", "Priority", "Status",
        "Created Date", "Due Date", "Follow-up Date", "Last Action", "Remarks", "Updated By", "Updated Date"
    ];

    const rows = tasks.map(function(task) {
        return [
            task.taskId, task.department, task.task, task.description, task.assignedTo,
            task.priority, task.status, task.createdDate, task.dueDate, task.followupDate,
            task.lastAction, task.remarks, task.updatedBy, task.updatedDate
        ];
    });

    const csv = [headers, ...rows].map(function(row) {
        return row.map(csvEscape).join(",");
    }).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "Excelso_Operations_Tasks.csv";
    link.click();

    URL.revokeObjectURL(url);

}

/* =========================================================
   DATE HELPERS
========================================================= */

function parseDate(value) {

    if (!value) return null;
    if (value instanceof Date) return value;

    const date = new Date(value);

    if (isNaN(date.getTime())) return null;

    return date;

}

function formatDateForInput(value) {

    if (!value) return "";

    const text = String(value);

    const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (direct) {
        return direct[1] + "-" + direct[2] + "-" + direct[3];
    }

    const date = parseDate(value);
    if (!date) return "";

    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");

}

function displayDate(value) {

    if (!value) return "-";

    const date = parseDate(value);
    if (!date) return value;

    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

}

function todayInput() { return formatDateForInput(new Date()); }

function sameDate(value, date) {

    const parsed = parseDate(value);
    if (!parsed) return false;

    return parsed.getFullYear() === date.getFullYear() &&
           parsed.getMonth() === date.getMonth() &&
           parsed.getDate() === date.getDate();

}

function dateBeforeToday(value) {

    const date = parseDate(value);
    if (!date) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    return date < today;

}

function isOverdue(task) {

    if (!task.dueDate || task.status === "Completed") return false;

    return dateBeforeToday(task.dueDate);

}

/* =========================================================
   BADGES
========================================================= */

function priorityBadge(priority) {
    return `<span class="priority-badge priority-${String(priority).toLowerCase()}">${escapeHTML(priority)}</span>`;
}

function statusBadge(status, task) {

    let displayStatus = status;

    if (status !== "Completed" && isOverdue(task)) {
        displayStatus = "Overdue";
    }

    return `<span class="status-badge status-${String(displayStatus).toLowerCase().replace(/\s+/g, "-")}">${escapeHTML(displayStatus)}</span>`;

}

/* =========================================================
   HELPERS
========================================================= */

function getDepartmentCode(department) {

    const codes = {
        "B2B - Sales": "B2B",
        "Customer Support": "CS",
        "Warehouse": "WH",
        "Scanning - Catalog": "SC",
        "Listing - Inventory": "LI",
        "Digital Marketing": "DM",
        "IT - Software Development": "IT",
        "Finance": "FN",
        "Book Fair - Events": "BF",
        "Books and Supply Procurement": "BP",
        "HR": "HR",
        "Data Analysis": "DA",
        "Software Testing": "ST",
        "Product Development": "PD"
    };

    return codes[department] || "DP";

}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setInput(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value || "";
}

function getInput(id) {
    const element = document.getElementById(id);
    return element ? element.value : "";
}

function escapeHTML(value) {

    if (value === null || value === undefined) return "";

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

function csvEscape(value) {
    const text = String(value ?? "");
    return '"' + text.replace(/"/g, '""') + '"';
}
<!-- ACTION LOADER (mini mascot shown while saving) -->
<div id="actionLoader" class="action-loader" aria-live="polite">
    <div class="action-loader-mascot">
        <div class="action-loader-page action-loader-page-1"></div>
        <div class="action-loader-page action-loader-page-2"></div>
        <div class="action-loader-spine"></div>
    </div>
    <span id="actionLoaderText">Saving…</span>
</div>
/* =========================================================
   NOTIFICATION
========================================================= */

function showNotification(title, message) {

    const notification = document.getElementById("notification");
    const titleElement = document.getElementById("notificationTitle");
    const messageElement = document.getElementById("notificationMessage");

    if (!notification) return;

    if (titleElement) titleElement.textContent = title;
    if (messageElement) messageElement.textContent = message;

    notification.classList.add("show");

    setTimeout(function() {
        notification.classList.remove("show");
    }, 3500);

}

/* =========================================================================
   NEW FEATURES — Backlog, Checklists, Task Detail Drawer, Book Fair
   ---------------------------------------------------------------------
   PERSISTENCE: Checklists, comments and backlog items are now saved
   through the Apps Script backend (Task Checklists / Task Comments /
   Backlog sheet tabs) via apiRequest() — the same pattern loadTasks()
   uses. Each is cached in memory (allChecklists, allComments,
   backlogTasks) and reloaded after every write, so everyone sees the
   same data regardless of device or browser.
========================================================================= */

let allChecklists = {};   // taskId -> array of checklist items
let allComments = {};     // taskId (or backlogId) -> array of comments
let backlogTasks = [];    // array of backlog items from the backend

let taskDetailCurrentId = "";
let backlogDetailCurrentId = "";

function generateLocalId(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function currentUserLabel() {
    return (currentUser && (currentUser.name || currentUser.username)) || "Website";
}

/* ---------------------------------------------------------------------
   BACKEND LOADERS
--------------------------------------------------------------------- */

async function loadAllChecklists() {

    const result = await apiRequest("getTaskChecklists", { taskId: "" });

    allChecklists = {};

    if (result && result.success && Array.isArray(result.checklists)) {
        result.checklists.forEach(function(item) {
            const key = item.taskId;
            if (!allChecklists[key]) allChecklists[key] = [];
            allChecklists[key].push(item);
        });
    }

}

async function loadAllComments() {

    const result = await apiRequest("getTaskComments", { taskId: "" });

    allComments = {};

    if (result && result.success && Array.isArray(result.comments)) {
        result.comments.forEach(function(item) {
            const key = item.taskId;
            if (!allComments[key]) allComments[key] = [];
            allComments[key].push(item);
        });
    }

}

async function loadBacklogTasks() {

    const result = await apiRequest("getBacklog", {});
    backlogTasks = (result && result.success && Array.isArray(result.tasks)) ? result.tasks : [];

}

/* ---------------------------------------------------------------------
   ROLE / ACCESS HELPERS
--------------------------------------------------------------------- */

function isPrivilegedUser() {

    if (!currentUser) return false;

    const role = String(currentUser.role || "").trim().toLowerCase();

    return role === "founder" || role === "operations head";

}

function currentUserMatches(assignedTo) {

    if (!currentUser) return false;

    const value = String(assignedTo || "").trim().toLowerCase();
    if (!value) return false;

    const username = String(currentUser.username || "").trim().toLowerCase();
    const name = String(currentUser.name || "").trim().toLowerCase();

    return value === username || value === name;

}

function sortMineFirst(list, getAssignee) {

    if (!Array.isArray(list)) return [];
    if (!currentUser || isPrivilegedUser()) return list.slice();

    return list
        .map(function(item, index) { return { item: item, index: index }; })
        .sort(function(a, b) {

            const aMine = currentUserMatches(getAssignee(a.item));
            const bMine = currentUserMatches(getAssignee(b.item));

            if (aMine && !bMine) return -1;
            if (!aMine && bMine) return 1;

            return a.index - b.index;

        })
        .map(function(wrapped) { return wrapped.item; });

}

/* ---------------------------------------------------------------------
   CHECKLISTS  (entityKey e.g. "task:T004", "bookfair:T011")
--------------------------------------------------------------------- */

function idFromEntityKey(entityKey) {
    const parts = String(entityKey || "").split(":");
    return parts.length > 1 ? parts.slice(1).join(":") : entityKey;
}

function getChecklist(entityKey) {
    return allChecklists[idFromEntityKey(entityKey)] || [];
}

function checklistStatusDot(entityKey) {

    const items = getChecklist(entityKey);

    if (!items.length) {
        return `<span class="checklist-dot checklist-dot-red" title="No checklist yet"></span>`;
    }

    const allDone = items.every(function(item) { return String(item.status).toLowerCase() === "completed"; });

    if (allDone) {
        return `<span class="checklist-dot checklist-dot-green" title="Checklist complete"></span>`;
    }

    return `<span class="checklist-dot checklist-dot-red" title="Checklist pending"></span>`;

}

async function addChecklistItem(entityKey, text) {

    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    await apiRequest("addChecklistItem", {
        taskId: idFromEntityKey(entityKey),
        item: trimmed,
        updatedBy: currentUserLabel()
    });

    await loadAllChecklists();

}

async function toggleChecklistItem(entityKey, itemId) {

    const item = getChecklist(entityKey).find(function(i) { return i.checklistId === itemId; });
    if (!item) return;

    const newStatus = String(item.status).toLowerCase() === "completed" ? "Pending" : "Completed";

    await apiRequest("updateChecklistStatus", {
        checklistId: itemId,
        status: newStatus,
        updatedBy: currentUserLabel()
    });

    await loadAllChecklists();

}

async function removeChecklistItem(entityKey, itemId) {

    await apiRequest("deleteChecklistItem", { checklistId: itemId });
    await loadAllChecklists();

}

/* Renders a checklist into any container, wiring up add/toggle/remove.
   `canAdd` controls whether new items can be added — anyone with access
   to the checklist can add. `canDelete` controls whether the remove (×)
   button appears — restricted to Founder / Operations Head, so regular
   users can contribute items but can't delete someone else's. Toggling
   an item's done status is allowed for anyone who can see the checklist. */
function renderChecklistInto(entityKey, listElement, formElement, inputElement, canAdd, canDelete, onChange) {

    if (!listElement) return;

    const items = getChecklist(entityKey);

    if (!items.length) {
        listElement.innerHTML = `<div class="checklist-empty">No checklist items yet.</div>`;
    } else {

        listElement.innerHTML = items.map(function(item) {

            const done = String(item.status).toLowerCase() === "completed";

            return `
                <div class="checklist-item ${done ? "is-done" : ""}" data-item-id="${escapeHtml(item.checklistId)}">
                    <input type="checkbox" ${done ? "checked" : ""} class="checklist-item-checkbox">
                    <span class="checklist-item-text">${escapeHtml(item.item)}</span>
                    ${canDelete ? `<button type="button" class="checklist-item-remove" aria-label="Remove item">×</button>` : ""}
                </div>
            `;
        }).join("");

        listElement.querySelectorAll(".checklist-item-checkbox").forEach(function(checkbox) {
            checkbox.addEventListener("change", async function() {

                const itemId = checkbox.closest(".checklist-item").dataset.itemId;
                const guardKey = "checklist-toggle-" + itemId;

                if (isRequestActive(guardKey)) {
                    checkbox.checked = !checkbox.checked; // revert the click, ignore
                    return;
                }

                checkbox.disabled = true;

                await guardAsync(guardKey, async function() {
                    await toggleChecklistItem(entityKey, itemId);
                });

                if (onChange) onChange();

            });
        });

        if (canDelete) {
            listElement.querySelectorAll(".checklist-item-remove").forEach(function(button) {
                button.addEventListener("click", async function() {

                    const itemId = button.closest(".checklist-item").dataset.itemId;
                    const guardKey = "checklist-remove-" + itemId;

                    if (isRequestActive(guardKey)) return;

                    button.disabled = true;

                    await guardAsync(guardKey, async function() {
                        await removeChecklistItem(entityKey, itemId);
                    });

                    if (onChange) onChange();

                });
            });
        }

    }

    if (formElement && !formElement.dataset.wired) {

        formElement.dataset.wired = "true";

        formElement.addEventListener("submit", async function(event) {

            event.preventDefault();

            const value = inputElement.value.trim();
            if (!value) return;

            const guardKey = "checklist-add-" + entityKey;
            if (isRequestActive(guardKey)) return;

            const submitButton = formElement.querySelector("button[type='submit']");
            setButtonLoading(submitButton, true);

            await guardAsync(guardKey, async function() {
                await addChecklistItem(entityKey, value);
            });

            inputElement.value = "";
            setButtonLoading(submitButton, false);

            if (onChange) onChange();

        });

    }

    if (formElement) {
        formElement.style.display = canAdd ? "flex" : "none";
    }

}

/* ---------------------------------------------------------------------
   COMMENTS  (entityKey e.g. "task:T004", "backlog:BL003")
--------------------------------------------------------------------- */

function getComments(entityKey) {
    return allComments[idFromEntityKey(entityKey)] || [];
}

async function addComment(entityKey, text) {

    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    await apiRequest("addTaskComment", {
        taskId: idFromEntityKey(entityKey),
        comment: trimmed,
        updatedBy: currentUserLabel()
    });

    await loadAllComments();

}

function formatCommentDate(comment) {

    if (comment.date && comment.time) {
        return comment.date + " · " + comment.time;
    }

    return comment.date || "";

}

function renderCommentsInto(entityKey, threadElement) {

    if (!threadElement) return;

    const comments = getComments(entityKey);

    if (!comments.length) {
        threadElement.innerHTML = `<div class="comment-empty">No comments yet — be the first to add one.</div>`;
        return;
    }

    threadElement.innerHTML = comments.map(function(comment) {
        return `
            <div class="comment-bubble">
                <div class="comment-bubble-head">
                    <span class="comment-bubble-author">${escapeHtml(comment.user)}</span>
                    <span class="comment-bubble-date">${escapeHtml(formatCommentDate(comment))}</span>
                </div>
                <div class="comment-bubble-text">${escapeHtml(comment.comment)}</div>
            </div>
        `;
    }).join("");

    threadElement.scrollTop = threadElement.scrollHeight;

}

/* =========================================================================
   TASK DETAIL DRAWER  (All Tasks / Master Tasks / Book Fair cards)
========================================================================= */

function initializeTaskDetailDrawer() {

    const checklistForm = document.getElementById("taskDetailChecklistForm");
    const checklistInput = document.getElementById("taskDetailChecklistInput");
    const checklistList = document.getElementById("taskDetailChecklistList");
    const progress = document.getElementById("taskDetailChecklistProgress");

    const refreshChecklist = function() {

        if (!taskDetailCurrentId) return;

        const entityKey = "task:" + taskDetailCurrentId;

        renderChecklistInto(entityKey, checklistList, checklistForm, checklistInput, true, isPrivilegedUser(), function() {
            refreshChecklist();
            updateChecklistProgressLabel(entityKey, progress);
        });

        updateChecklistProgressLabel(entityKey, progress);

        renderTasksTable();
        if (currentDepartment) renderDepartmentTasks(tasks.filter(function(t) { return t.department === currentDepartment; }));
        renderBookFair();

    };

    taskDetailRefreshChecklist = refreshChecklist;

    const commentForm = document.getElementById("taskDetailCommentForm");
    const commentInput = document.getElementById("taskDetailCommentInput");

       if (commentForm) {
        commentForm.addEventListener("submit", async function(event) {

            event.preventDefault();
            if (!taskDetailCurrentId) return;

            const value = commentInput.value.trim();
            if (!value) return;

            const guardKey = "comment-task-" + taskDetailCurrentId;
            if (isRequestActive(guardKey)) return;

            const submitButton = commentForm.querySelector("button[type='submit']");
            setButtonLoading(submitButton, true);

            await guardAsync(guardKey, async function() {
                await addComment("task:" + taskDetailCurrentId, value);
            });

            commentInput.value = "";
            setButtonLoading(submitButton, false);

            renderCommentsInto("task:" + taskDetailCurrentId, document.getElementById("taskDetailComments"));

        });
    }
    const statusSelect = document.getElementById("taskDetailStatus");

    if (statusSelect) {
        statusSelect.addEventListener("change", async function() {

            if (!taskDetailCurrentId) return;

            const task = tasks.find(function(t) { return t.taskId === taskDetailCurrentId; });
            if (!task) return;

            const updated = Object.assign({}, task, { status: statusSelect.value, updatedBy: currentUser?.name || currentUser?.username || "" });

            const result = await apiRequest("updateTask", { task: { taskId: updated.taskId, status: updated.status, updatedBy: updated.updatedBy } });

            if (result && result.success) {
                showNotification("Updated", "Task status updated.");
                await loadTasks();
            } else {
                showNotification("Error", result?.message || "Unable to update status.");
            }

        });
    }

    const saveMetaButton = document.getElementById("taskDetailSaveMetaButton");

    if (saveMetaButton) {
        saveMetaButton.addEventListener("click", async function() {

            if (!taskDetailCurrentId) return;

            const payload = {
                taskId: taskDetailCurrentId,
                assignedTo: document.getElementById("taskDetailAssignedTo").value,
                priority: document.getElementById("taskDetailPriority").value,
                dueDate: document.getElementById("taskDetailDueDate").value,
                followupDate: document.getElementById("taskDetailFollowupDate").value,
                updatedBy: currentUser?.name || currentUser?.username || ""
            };

            saveMetaButton.disabled = true;
            saveMetaButton.textContent = "Saving...";

            const result = await apiRequest("updateTask", { task: payload });

            saveMetaButton.disabled = false;
            saveMetaButton.textContent = "Save Changes";

            if (result && result.success) {
                showNotification("Saved", "Task details updated.");
                await loadTasks();
            } else {
                showNotification("Error", result?.message || "Unable to save changes.");
            }

        });
    }

    const descriptionField = document.getElementById("taskDetailDescription");

    if (descriptionField) {
        descriptionField.addEventListener("blur", async function() {

            if (!taskDetailCurrentId || !isPrivilegedUser()) return;

            const task = tasks.find(function(t) { return t.taskId === taskDetailCurrentId; });
            if (!task || task.description === descriptionField.value) return;

            const result = await apiRequest("updateTask", { task: { taskId: taskDetailCurrentId, description: descriptionField.value, updatedBy: currentUser?.name || currentUser?.username || "" } });

            if (result && result.success) {
                await loadTasks();
            }

        });
    }

}

let taskDetailRefreshChecklist = function() {};

function updateChecklistProgressLabel(entityKey, progressElement) {

    if (!progressElement) return;

    const items = getChecklist(entityKey);
    const done = items.filter(function(item) { return String(item.status).toLowerCase() === "completed"; }).length;

    progressElement.textContent = done + "/" + items.length;

}

function openTaskDetailDrawer(taskId) {

    const task = tasks.find(function(t) { return t.taskId === taskId; });

    if (!task) {
        showNotification("Error", "Task not found.");
        return;
    }

    taskDetailCurrentId = taskId;

    const privileged = isPrivilegedUser();

    setText("taskDetailName", task.task);
    setInput("taskDetailDescription", task.description);
    setInput("taskDetailId", task.taskId);
    setInput("taskDetailDepartment", task.department);
    setInput("taskDetailAssignedTo", task.assignedTo);
    setInput("taskDetailPriority", task.priority);
    setInput("taskDetailStatus", task.status);
    setInput("taskDetailCreatedDate", task.createdDate);
    setInput("taskDetailDueDate", task.dueDate);
    setInput("taskDetailFollowupDate", task.followupDate);

    ["taskDetailAssignedTo", "taskDetailPriority", "taskDetailDueDate", "taskDetailFollowupDate"].forEach(function(id) {
        const element = document.getElementById(id);
        if (element) element.disabled = !privileged;
    });

    const description = document.getElementById("taskDetailDescription");
    if (description) description.disabled = !privileged;

    const saveMetaButton = document.getElementById("taskDetailSaveMetaButton");
    const lockedNote = document.getElementById("taskDetailLockedNote");

    if (saveMetaButton) saveMetaButton.style.display = privileged ? "block" : "none";
    if (lockedNote) lockedNote.style.display = privileged ? "none" : "block";

    const entityKey = "task:" + taskId;

    renderChecklistInto(
        entityKey,
        document.getElementById("taskDetailChecklistList"),
        document.getElementById("taskDetailChecklistForm"),
        document.getElementById("taskDetailChecklistInput"),
        true,
        privileged,
        taskDetailRefreshChecklist
    );

    updateChecklistProgressLabel(entityKey, document.getElementById("taskDetailChecklistProgress"));
    renderCommentsInto(entityKey, document.getElementById("taskDetailComments"));

    const drawer = document.getElementById("taskDetailDrawer");
    if (drawer) drawer.style.display = "block";
    document.body.classList.add("modal-open");

}

function closeTaskDetailDrawer() {

    const drawer = document.getElementById("taskDetailDrawer");
    if (drawer) drawer.style.display = "none";

    document.body.classList.remove("modal-open");
    taskDetailCurrentId = "";

    renderTasksTable();
    renderBookFair();

}

/* =========================================================================
   BACKLOG
========================================================================= */

function initializeBacklog() {

    const addButton = document.getElementById("backlogAddButton");
    const modal = document.getElementById("backlogItemModal");
    const closeButton = document.getElementById("closeBacklogModal");
    const cancelButton = document.getElementById("cancelBacklogButton");
    const form = document.getElementById("backlogItemForm");

    if (addButton) {
        addButton.addEventListener("click", function() { openBacklogItemModal(); });
    }

    if (closeButton) closeButton.addEventListener("click", closeBacklogItemModal);
    if (cancelButton) cancelButton.addEventListener("click", closeBacklogItemModal);

    if (modal) {
        modal.addEventListener("click", function(event) {
            if (event.target === modal) closeBacklogItemModal();
        });
    }

       if (form) {
        form.addEventListener("submit", async function(event) {

            event.preventDefault();

            if (isRequestActive("saveBacklog")) return;

            const submitButton = document.getElementById("saveBacklogItemButton");
            setButtonLoading(submitButton, true);

            await guardAsync("saveBacklog", saveBacklogItemFromForm);

            setButtonLoading(submitButton, false);

        });
    }

    const commentForm = document.getElementById("backlogDetailCommentForm");
    const commentInput = document.getElementById("backlogDetailCommentInput");

       if (commentForm) {
        commentForm.addEventListener("submit", async function(event) {

            event.preventDefault();
            if (!backlogDetailCurrentId) return;

            const value = commentInput.value.trim();
            if (!value) return;

            const guardKey = "comment-backlog-" + backlogDetailCurrentId;
            if (isRequestActive(guardKey)) return;

            const submitButton = commentForm.querySelector("button[type='submit']");
            setButtonLoading(submitButton, true);

            await guardAsync(guardKey, async function() {
                await addComment("backlog:" + backlogDetailCurrentId, value);
            });

            commentInput.value = "";
            setButtonLoading(submitButton, false);

            renderCommentsInto("backlog:" + backlogDetailCurrentId, document.getElementById("backlogDetailComments"));
            renderBacklog();

        });
    }

}

function openBacklogItemModal(item = null) {

    const modal = document.getElementById("backlogItemModal");
    if (!modal) return;

    const title = document.getElementById("backlogModalTitle");

    if (item) {

        title.textContent = "Edit Backlog Item";
        setInput("editBacklogId", item.backlogId);
        setInput("backlogTitle", item.task);
        setInput("backlogDepartment", item.department);
        setInput("backlogStatus", item.status || "Future");
        setInput("backlogDescription", item.description);

    } else {

        title.textContent = "Add Backlog Item";
        setInput("editBacklogId", "");
        setInput("backlogTitle", "");
        setInput("backlogDepartment", "");
        setInput("backlogStatus", "Future");
        setInput("backlogDescription", "");

    }

    modal.style.display = "flex";
    document.body.classList.add("modal-open");

}

function closeBacklogItemModal() {

    const modal = document.getElementById("backlogItemModal");
    if (modal) modal.style.display = "none";

    document.body.classList.remove("modal-open");

}

async function saveBacklogItemFromForm() {

    const editId = getInput("editBacklogId");
    const title = getInput("backlogTitle").trim();

    if (!title) {
        showNotification("Missing Information", "Please enter a title.");
        return;
    }

    const payload = {
        task: title,
        department: getInput("backlogDepartment"),
        status: getInput("backlogStatus") || "Future",
        description: getInput("backlogDescription"),
        updatedBy: currentUserLabel()
    };

    const result = editId
        ? await apiRequest("updateBacklogTask", Object.assign({ backlogId: editId }, payload))
        : await apiRequest("createBacklogTask", payload);

    if (!result || !result.success) {
        showNotification("Error", (result && result.message) || "Unable to save backlog item.");
        return;
    }

    await loadBacklogTasks();

    closeBacklogItemModal();
    showNotification("Saved", "Backlog item saved.");
    renderBacklog();

}

function renderBacklog() {

    const grid = document.getElementById("backlogGrid");
    if (!grid) return;

    const ordered = sortMineFirst(backlogTasks, function(item) { return item.createdBy; });

    if (!ordered.length) {
        grid.innerHTML = `<div class="empty-state">No backlog items yet. Add future or paused work to keep track of it here.</div>`;
        return;
    }

    grid.innerHTML = ordered.map(function(item) {

        const commentCount = getComments("backlog:" + item.backlogId).length;
        const statusClass = String(item.status || "Future").toLowerCase() === "paused" ? "status-paused" : "status-backlog";

        return `
            <div class="backlog-card" data-id="${escapeHtml(item.backlogId)}">
                <div class="backlog-card-top">
                    <span class="backlog-status-chip ${statusClass}">${escapeHtml(item.status || "Future")}</span>
                    ${isPrivilegedUser() ? `<button type="button" class="table-action backlog-edit-button" data-id="${escapeHtml(item.backlogId)}">Edit</button>` : ""}
                </div>
                <h3>${escapeHtml(item.task)}</h3>
                <p class="backlog-card-description">${escapeHtml(item.description || "No description yet.")}</p>
                <div class="backlog-card-footer">
                    <span>${escapeHtml(item.department || "Unassigned")} · ${escapeHtml(displayDate(item.createdDate))}</span>
                    <span class="backlog-card-comment-count">💬 ${commentCount}</span>
                </div>
            </div>
        `;

    }).join("");

    grid.querySelectorAll(".backlog-card").forEach(function(card) {
        card.addEventListener("click", function(event) {
            if (event.target.closest(".backlog-edit-button")) return;
            openBacklogDetailDrawer(card.dataset.id);
        });
    });

    grid.querySelectorAll(".backlog-edit-button").forEach(function(button) {
        button.addEventListener("click", function(event) {
            event.stopPropagation();
            const item = backlogTasks.find(function(i) { return i.backlogId === button.dataset.id; });
            if (item) openBacklogItemModal(item);
        });
    });

}

function openBacklogDetailDrawer(id) {

    const item = backlogTasks.find(function(i) { return i.backlogId === id; });
    if (!item) return;

    backlogDetailCurrentId = id;

    setText("backlogDetailStatusLabel", (item.status || "Future").toUpperCase());
    setText("backlogDetailTitle", item.task);
    setText("backlogDetailCreatedDate", displayDate(item.createdDate));
    setText("backlogDetailDepartment", item.department ? "· " + item.department : "");
    setText("backlogDetailDescription", item.description || "No description yet.");

    renderCommentsInto("backlog:" + id, document.getElementById("backlogDetailComments"));

    const drawer = document.getElementById("backlogDetailDrawer");
    if (drawer) drawer.style.display = "block";
    document.body.classList.add("modal-open");

}

function closeBacklogDetailDrawer() {

    const drawer = document.getElementById("backlogDetailDrawer");
    if (drawer) drawer.style.display = "none";

    document.body.classList.remove("modal-open");
    backlogDetailCurrentId = "";

}

/* =========================================================================
   BOOK FAIR
========================================================================= */

function initializeBookFair() {

    const addButton = document.getElementById("bookFairAddButton");

    if (addButton) {
        addButton.addEventListener("click", function() {
            currentDepartment = "Book Fair - Events";
            openTaskModal();
        });
    }

}

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

function renderBookFair() {

    const grid = document.getElementById("bookFairGrid");
    if (!grid) return;

    const bookFairTasks = tasks.filter(function(task) { return task.department === "Book Fair - Events"; });
    const ordered = sortMineFirst(bookFairTasks, function(task) { return task.assignedTo; })
        .slice()
        .sort(function(a, b) {

            const rankA = PRIORITY_RANK[a.priority] ?? 3;
            const rankB = PRIORITY_RANK[b.priority] ?? 3;

            if (rankA !== rankB) return rankA - rankB;

            return String(a.dueDate).localeCompare(String(b.dueDate));

        });

    if (!ordered.length) {
        grid.innerHTML = `<div class="empty-state">No Book Fair tasks yet. Add one to get started.</div>`;
        return;
    }

    grid.innerHTML = ordered.map(function(task) {

        const priorityClass = "priority-border-" + String(task.priority || "").toLowerCase();

        return `
            <div class="bookfair-card ${priorityClass}" data-id="${escapeHtml(task.taskId)}">
                <div class="bookfair-card-top">
                    <h3>${escapeHtml(task.task)}</h3>
                    ${priorityBadge(task.priority)}
                </div>
                <div class="bookfair-card-meta">
                    <span>${statusBadge(task.status, task)}</span>
                    <span>${escapeHtml(task.assignedTo || "Unassigned")}</span>
                    <span>Due ${escapeHtml(displayDate(task.dueDate))}</span>
                </div>
                <div class="bookfair-checklist-mini">
                    <div class="detail-drawer-section-header">
                        <h3>Checklist</h3>
                        <span class="checklist-progress" id="bfProgress-${escapeHtml(task.taskId)}"></span>
                    </div>
                    <div class="checklist-list" id="bfChecklist-${escapeHtml(task.taskId)}"></div>
                    <form class="checklist-add-form" id="bfChecklistForm-${escapeHtml(task.taskId)}">
                        <input type="text" placeholder="Add checklist item..." id="bfChecklistInput-${escapeHtml(task.taskId)}">
                        <button type="submit">+ Add</button>
                    </form>
                </div>
            </div>
        `;

    }).join("");

    ordered.forEach(function(task) {

        const entityKey = "task:" + task.taskId;
        const listEl = document.getElementById("bfChecklist-" + task.taskId);
        const formEl = document.getElementById("bfChecklistForm-" + task.taskId);
        const inputEl = document.getElementById("bfChecklistInput-" + task.taskId);
        const progressEl = document.getElementById("bfProgress-" + task.taskId);

        const refresh = function() {
            renderChecklistInto(entityKey, listEl, formEl, inputEl, true, isPrivilegedUser(), refresh);
            updateChecklistProgressLabel(entityKey, progressEl);
        };

        refresh();

    });

    grid.querySelectorAll(".bookfair-card-top, .bookfair-card-meta").forEach(function(clickable) {
        clickable.addEventListener("click", function() {
            const card = clickable.closest(".bookfair-card");
            openTaskDetailDrawer(card.dataset.id);
        });
    });

}
