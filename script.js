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

        group.forEach(function(task) {
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

    tbody.innerHTML = "";

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-table">No matching tasks available.</td></tr>`;
        return;
    }

    filtered.forEach(function(task) {

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td><strong>${escapeHTML(task.task)}</strong></td>
            <td>${escapeHTML(task.department)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${displayDate(task.dueDate)}</td>
            <td><button class="table-action edit-task" data-id="${escapeHTML(task.taskId)}">Edit</button></td>
        `;

        tbody.appendChild(row);

    });

    tbody.querySelectorAll(".edit-task").forEach(function(button) {
        button.addEventListener("click", function() { editTask(button.dataset.id); });
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

    tbody.innerHTML = "";

    if (!departmentTasks.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-table">No department tasks available.</td></tr>`;
        return;
    }

    departmentTasks.forEach(function(task) {

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHTML(task.taskId)}</td>
            <td>${escapeHTML(task.task)}</td>
            <td>${escapeHTML(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${displayDate(task.dueDate)}</td>
            <td>${displayDate(task.followupDate)}</td>
            <td><button class="table-action edit-department-task" data-id="${escapeHTML(task.taskId)}">Edit</button></td>
        `;

        tbody.appendChild(row);

    });

    tbody.querySelectorAll(".edit-department-task").forEach(function(button) {
        button.addEventListener("click", function() { editTask(button.dataset.id); });
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

    if (isSavingTask) return;

    isSavingTask = true;

    const submitButton = document.querySelector("#taskForm .primary-button");

    setButtonLoading(submitButton, true);

    try {
        await saveTaskRequest();
    }
    finally {
        isSavingTask = false;
        setButtonLoading(submitButton, false);
    }

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
<td class="task-actions">

    <button
        type="button"
        class="secondary-button"
        onclick="openTaskDetail('${escapeHtml(task.taskId)}')">

        Open

    </button>

    <button
        type="button"
        class="secondary-button"
        onclick="editTask('${escapeHtml(task.taskId)}')">

        Edit

    </button>

</td>
