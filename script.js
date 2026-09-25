/* =========================================================
   EXCELSO OPERATIONS MANAGEMENT SYSTEM — FRONTEND  (v6)

   Pairs with Code.gs v6. Main changes:
   - Login returns a session token; every request carries it.
   - One "bootstrap" request loads everything (was 5 requests).
   - Non-admins see: My Tasks (any department) + a collapsible
     "Others in <my department>" section, on All Tasks, Regular
     Tasks and Book Fair.
   - "Blocked" is now "On Hold".
   - Owners are picked from a dropdown fed by the Users sheet,
     and a task can have several owners.
   - Checklist ticks, new checklist items, comments and status
     changes update on screen instantly and save in the background.
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

const STATUS_ON_HOLD = "On Hold";

let tasks = [];
let regularTasks = [];
let backlogTasks = [];
let allChecklists = {};   // taskId / regularTaskId -> [items]
let allComments = {};     // taskId / backlogId -> [comments]
let users = [];           // from the Users sheet (for the owner dropdown)

let currentUser = null;
let sessionToken = "";

let currentDepartment = "";
let currentPage = "dashboard";

let dataEverLoaded = false;
let dataLoadFailed = false;
let lastLoadedAt = 0;
let coreLoadPromise = null;

let taskDetailCurrentId = "";
let backlogDetailCurrentId = "";
let regularTaskChecklistCurrentId = "";

// Which "Others in my department" sections are expanded, per page.
const expandedSections = {};

let taskOwnerPicker = null;
let taskDetailOwnerPicker = null;

/* =========================================================
   SMALL HELPERS
========================================================= */

function debounce(fn, wait = 150) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

function batchRows(container, items, buildNode) {
    const fragment = document.createDocumentFragment();
    items.forEach(function (item) { fragment.appendChild(buildNode(item)); });
    container.appendChild(fragment);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const escapeHTML = escapeHtml;

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

function csvEscape(value) {
    return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function tempId(prefix) {
    return "tmp-" + prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* =========================================================
   LOCAL CACHE — instant paint on refresh, per user
========================================================= */

const CACHE_PREFIX = "usedbookrCache6:";

function cacheKeyForUser() {
    return CACHE_PREFIX + String(currentUser?.username || "").toLowerCase();
}

function persistLocalCache() {
    if (!currentUser) return;
    try {
        sessionStorage.setItem(cacheKeyForUser(), JSON.stringify({
            savedAt: Date.now(),
            tasks: tasks,
            regularTasks: regularTasks,
            backlog: backlogTasks,
            users: users,
            checklists: allChecklists,
            comments: allComments
        }));
    } catch (error) {
        // storage full / private mode — caching is optional
    }
}

const persistLocalCacheSoon = debounce(persistLocalCache, 400);

function readLocalCache() {
    try {
        const raw = sessionStorage.getItem(cacheKeyForUser());
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function clearLocalCaches() {
    try {
        Object.keys(sessionStorage).forEach(function (key) {
            if (key.indexOf("usedbookrCache") === 0) sessionStorage.removeItem(key);
        });
    } catch (error) { /* ignore */ }
}

/* =========================================================
   SKELETONS
========================================================= */

function skeletonCards(count = 4) {
    let html = "";
    for (let i = 0; i < count; i++) {
        html += `<div class="skeleton-card"><div class="skeleton-bar skeleton-bar-title"></div><div class="skeleton-bar" style="width:70%;"></div><div class="skeleton-bar" style="width:45%;"></div></div>`;
    }
    return html;
}

/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    initializeDepartments();
    initializeDate();
    initializeNavigation();
    initializeOwnerPickers();
    initializeTaskButtons();
    initializeFilters();
    initializeTaskForm();
    initializeLogout();
    initializeLogin();
    initializePasswordToggle();
    initializeGlobalStatusBanner();
    initializeRegularTaskUpdateForm();
    initializeExports();
    initializeSidebarToggle();
    initializeBacklog();
    initializeBookFair();
    initializeTaskDetailDrawer();
    initializeTableDelegation();
    initializeRegularTasksPage();
    initializeKeyboardShortcuts();
    initializeBackgroundRefresh();

    checkLogin();
    initializePageLoader();

});

function initializePageLoader() {

    const MIN_VISIBLE_MS = 300;
    const FADE_MS = 300;
    const start = Date.now();
    let done = false;

    const hide = function () {
        if (done) return;
        done = true;
        const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - start));
        setTimeout(function () {
            const loader = document.getElementById("pageLoader");
            if (!loader) return;
            loader.classList.add("loader-hidden");
            setTimeout(function () { loader.style.display = "none"; }, FADE_MS);
        }, remaining);
    };

    if (document.readyState === "complete") hide();
    else {
        window.addEventListener("load", hide);
        setTimeout(hide, 1200);
    }

}

/* =========================================================
   LOGIN / SESSION
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

        const showError = function (message) {
            if (!error) return;
            error.textContent = message;
            error.classList.add("show");
        };

        if (error) { error.classList.remove("show"); error.textContent = ""; }

        if (!username || !password) {
            showError("Please enter your username and password.");
            return;
        }

        setButtonLoading(submitButton, true);

        try {

            const result = await apiRequest("login", { username: username, password: password }, { silent: true });

            if (!result || !result.success || !result.user || !result.token) {
                showError(result?.message || "Invalid username or password.");
                return;
            }

            currentUser = result.user;
            sessionToken = result.token;

            sessionStorage.setItem("usedbookrCurrentUser", JSON.stringify(currentUser));
            sessionStorage.setItem("usedbookrSessionToken", sessionToken);

            enterApp();

        }
        catch (err) {
            console.error("LOGIN ERROR:", err);
            showError("Unable to connect to the server. Check your internet connection and try again.");
        }
        finally {
            setButtonLoading(submitButton, false);
        }

    });

}

function checkLogin() {

    const savedUser = sessionStorage.getItem("usedbookrCurrentUser");
    const savedToken = sessionStorage.getItem("usedbookrSessionToken");

    if (savedUser && savedToken) {
        try {
            currentUser = JSON.parse(savedUser);
            sessionToken = savedToken;
            enterApp();
            return;
        }
        catch (error) {
            console.error("SESSION RESTORE ERROR:", error);
        }
    }

    // Old (pre-v6) sessions have no token — ask them to sign in once.
    logoutUser({ silent: true });

}

function enterApp() {

    hideLogin();
    updateLoggedInUserProfile();
    applyUserAccess();

    // Paint the last known data for this user instantly, then refresh.
    const cached = readLocalCache();
    if (cached) applyDataSnapshot(cached);

    renderCurrentPage();
    loadCoreData();

}

function logoutUser(options = {}) {

    if (sessionToken && !options.silent) {
        // Fire-and-forget: tell the server to end the session.
        apiRequest("logout", {}, { silent: true });
    }

    currentUser = null;
    sessionToken = "";
    tasks = [];
    regularTasks = [];
    backlogTasks = [];
    allChecklists = {};
    allComments = {};
    users = [];
    dataEverLoaded = false;

    sessionStorage.removeItem("usedbookrCurrentUser");
    sessionStorage.removeItem("usedbookrSessionToken");
    sessionStorage.removeItem("usedbookrOperationsLogin");
    clearLocalCaches();

    closeAllOverlays();
    showLogin();

    setInput("loginUsername", "");
    setInput("loginPassword", "");

}

function handleSessionExpired() {

    const wasLoggedIn = !!currentUser;

    logoutUser({ silent: true });

    if (wasLoggedIn) {
        const error = document.getElementById("loginError");
        if (error) {
            error.textContent = "Your session has expired. Please sign in again.";
            error.classList.add("show");
        }
    }

}

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

function initializePasswordToggle() {

    const toggle = document.getElementById("togglePasswordVisibility");
    const input = document.getElementById("loginPassword");
    if (!toggle || !input) return;

    const eyeIcon = toggle.querySelector(".icon-eye");
    const eyeOffIcon = toggle.querySelector(".icon-eye-off");

    toggle.addEventListener("click", function () {
        const hidden = input.type === "password";
        input.type = hidden ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(hidden));
        toggle.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
        if (eyeIcon) eyeIcon.style.display = hidden ? "none" : "";
        if (eyeOffIcon) eyeOffIcon.style.display = hidden ? "" : "none";
        input.focus();
    });

}

function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle("is-loading", !!isLoading);
    button.disabled = !!isLoading;
}

function initializeLogout() {
    const button = document.getElementById("logoutButton");
    if (button) button.addEventListener("click", function () { logoutUser(); });
}

function updateLoggedInUserProfile() {

    if (!currentUser) return;

    const name = String(currentUser.name || "").trim();
    const role = String(currentUser.role || "").trim();
    const username = String(currentUser.username || "").trim();

    setText("loggedUserName", name || username || "User");
    setText("loggedUserRole", role || "User");

    const words = name.replace(/\./g, " ").split(/\s+/).filter(Boolean);
    let initials = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] || username).substring(0, 2);

    setText("loggedUserAvatar", initials.toUpperCase());

}

/* Non-admins: scope text, hide the admin-only department filter
   on Regular Tasks. */
function applyUserAccess() {

    if (!currentUser) return;

    const privileged = isPrivilegedUser();
    const primary = primaryDepartment();

    const filterPanel = document.getElementById("regularTasksFilterPanel");
    if (filterPanel) filterPanel.style.display = privileged ? "" : "none";

    if (privileged) {
        setText("tasksScopeText", "Manage tasks across all departments.");
        setText("dashboardScopeText", "Monitor tasks, priorities and follow-ups across all 14 departments.");
        setText("totalTasksScope", "All departments");
    } else {
        const deptText = primary ? ` and the rest of ${primary}` : "";
        setText("tasksScopeText", `Your tasks across every department${deptText}.`);
        setText("dashboardScopeText", `Your tasks${deptText}.`);
        setText("totalTasksScope", primary ? `Yours + ${primary}` : "Assigned to you");
    }

}

/* =========================================================
   ROLE / OWNER HELPERS
========================================================= */

function isPrivilegedUser() {
    if (!currentUser) return false;
    const role = String(currentUser.role || "").trim().toLowerCase();
    return role === "founder" || role === "operations head";
}

function primaryDepartment() {
    const primary = String(currentUser?.primaryDepartment || "").trim();
    return primary && primary.toLowerCase() !== "all" ? primary : "";
}

function currentUserLabel() {
    return (currentUser && (currentUser.name || currentUser.username)) || "Website";
}

/* Splits "Tarun, Royston" / "Tarun/Bhuvana" into separate names. */
function splitOwners(value) {
    return String(value || "")
        .split(/[,;\/&\n]+/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
}

function joinOwners(list) {
    return list.join(", ");
}

/* Makes "Mr.Tarun", "tarun" and "Tarun " compare equal. */
function normalizePersonName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/^\s*(mr|mrs|ms|miss|dr|sri|smt)(\.\s*|\s+)/i, "")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* A stored owner name matches a user when it equals their name,
   their username, or just their first name ("Sundara" → "Sundara Gandhi"). */
function ownerMatchesUser(ownerToken, user) {
    const owner = normalizePersonName(ownerToken);
    if (!owner || !user) return false;

    const name = normalizePersonName(user.name);
    const username = normalizePersonName(user.username);

    if (owner === name || owner === username) return true;

    const firstName = name.split(" ")[0];
    return !!firstName && owner === firstName;
}

function currentUserMatches(assignedTo) {
    if (!currentUser) return false;
    return splitOwners(assignedTo).some(function (token) { return ownerMatchesUser(token, currentUser); });
}

function ownersDisplay(assignedTo) {
    const owners = splitOwners(assignedTo);
    if (!owners.length) return `<span class="owner-none">Unassigned</span>`;
    return owners.map(function (owner) {
        const mine = ownerMatchesUser(owner, currentUser);
        return `<span class="owner-chip${mine ? " owner-chip-me" : ""}">${escapeHtml(owner)}</span>`;
    }).join("");
}

/* Same rule as the server: admins see everything; others see their
   own items (any department) plus their primary department. */
function canSeeItem(item) {
    if (!currentUser) return false;
    if (isPrivilegedUser()) return true;
    if (currentUserMatches(item.assignedTo)) return true;
    const primary = primaryDepartment();
    return !!primary && String(item.department || "").trim().toLowerCase() === primary.toLowerCase();
}

/* =========================================================
   STATUS
========================================================= */

function normalizeStatus(status) {
    const s = String(status || "").trim();
    const lower = s.toLowerCase();
    if (lower === "blocked" || lower === "on hold" || lower === "onhold" || lower === "hold") return STATUS_ON_HOLD;
    if (lower === "in progress" || lower === "inprogress") return "In Progress";
    if (lower === "open") return "Open";
    if (lower === "completed" || lower === "done") return "Completed";
    return s || "Open";
}

/* =========================================================
   DEPARTMENTS (dropdowns)
========================================================= */

function fillDepartmentSelect(id, firstLabel) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>` +
        DEPARTMENTS.map(function (d) { return `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; }).join("");
}

function initializeDepartments() {
    fillDepartmentSelect("taskDepartment", "Select Department");
    fillDepartmentSelect("departmentFilter", "All Departments");
    fillDepartmentSelect("backlogDepartment", "Unassigned");
    fillDepartmentSelect("backlogDepartmentFilter", "All Departments");
}

function initializeDate() {
    setText("currentDate", new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }));
}

/* =========================================================
   NAVIGATION
========================================================= */

function initializeNavigation() {

    document.querySelectorAll(".nav-item").forEach(function (item) {
        item.addEventListener("click", function () {
            if (item.dataset.department) openDepartment(item.dataset.department);
            else if (item.dataset.page) showPage(item.dataset.page);
            closeSidebarOnMobile();
        });
    });

    const menu = document.getElementById("menuToggle");
    if (menu) menu.addEventListener("click", toggleSidebar);

}

function initializeSidebarToggle() {
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) backdrop.addEventListener("click", closeSidebarOnMobile);
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
    document.querySelector(".sidebar")?.classList.remove("sidebar-open");
    document.getElementById("sidebarBackdrop")?.classList.remove("show");
    document.getElementById("menuToggle")?.classList.remove("is-open");
}

function showPage(page) {

    currentPage = page;

    document.querySelectorAll(".page").forEach(function (section) { section.classList.remove("active-page"); });
    document.getElementById(page + "Page")?.classList.add("active-page");

    document.querySelectorAll(".nav-item").forEach(function (item) {
        item.classList.toggle("active", item.dataset.page === page);
    });

    updatePageHeader(page);
    renderCurrentPage();

}

function updatePageHeader(page) {

    const names = {
        dashboard: ["Operations Dashboard", "Centralized operational monitoring"],
        tasks: ["All Tasks", isPrivilegedUser() ? "Manage tasks across all departments" : "Your tasks and your department's tasks"],
        regularTasks: ["Regular Tasks", "Complete and update your recurring operational tasks"],
        followups: ["Follow-ups", "Monitor commitments and pending actions"],
        activity: ["Activity Log", "Track operational changes"],
        backlog: ["Backlog", "Future and paused tasks parked for later"],
        bookFair: ["Book Fair", "Tasks and checklists for Book Fair / Events"]
    };

    if (names[page]) {
        setText("pageTitle", names[page][0]);
        setText("pageSubtitle", names[page][1]);
    }

}

/* Only re-render what's on screen — switching pages renders the new one. */
function renderCurrentPage() {

    switch (currentPage) {
        case "dashboard": updateDashboard(); break;
        case "tasks": renderTasksTable(); break;
        case "regularTasks": renderRegularTasks(); break;
        case "followups": updateFollowupSummary(); renderFollowups(); break;
        case "activity": renderActivity(); break;
        case "backlog": renderBacklog(); break;
        case "bookFair": renderBookFair(); break;
        case "department": if (currentDepartment) showDepartmentPage(currentDepartment); break;
        case "departments": renderDepartmentCards(); break;
    }

}

/* =========================================================
   GLOBAL STATUS BANNER
========================================================= */

let globalStatusRetryHandler = null;

function initializeGlobalStatusBanner() {
    document.getElementById("globalStatusBannerDismiss")?.addEventListener("click", hideGlobalStatusBanner);
    document.getElementById("globalStatusBannerRetry")?.addEventListener("click", function () {
        if (typeof globalStatusRetryHandler === "function") globalStatusRetryHandler();
    });
}

function showGlobalStatusBanner(message, options = {}) {

    const banner = document.getElementById("globalStatusBanner");
    const retryButton = document.getElementById("globalStatusBannerRetry");
    if (!banner) return;

    // Never let a "still loading" notice cover up a real error.
    if (options.kind === "slow" && banner.classList.contains("show") && banner.dataset.kind === "error") return;

    setText("globalStatusBannerText", message);
    banner.dataset.kind = options.kind || (options.isError ? "error" : "info");
    banner.classList.toggle("is-error", !!options.isError);
    banner.classList.add("show");

    if (retryButton) {
        globalStatusRetryHandler = options.onRetry || null;
        retryButton.style.display = options.onRetry ? "" : "none";
    }

}

function hideGlobalStatusBanner() {
    const banner = document.getElementById("globalStatusBanner");
    if (banner) banner.classList.remove("show");
    globalStatusRetryHandler = null;
}

let slowRequestCount = 0;

function slowRequestStarted() {
    slowRequestCount++;
    showGlobalStatusBanner("Still working — Google Sheets is taking longer than usual…", { kind: "slow" });
}

function slowRequestEnded() {
    slowRequestCount = Math.max(0, slowRequestCount - 1);
    const banner = document.getElementById("globalStatusBanner");
    if (slowRequestCount === 0 && banner && banner.dataset.kind === "slow") hideGlobalStatusBanner();
}

/* =========================================================
   API REQUEST
   - Sends the session token with every call.
   - Times out instead of hanging forever.
   - Retries only safe (repeatable) actions after a dropped
     connection. Anything that ADDS a row is never retried,
     otherwise it could be saved twice.
========================================================= */

const NON_IDEMPOTENT_ACTIONS = new Set([
    "login", "createTask", "addTask", "createBacklogTask", "addChecklistItem",
    "addTaskComment", "addBookFairChecklistItem", "moveBacklogToTask",
    "saveRegularTaskUpdate", "deleteChecklistItem", "deleteTask"
]);

const REQUEST_TIMEOUT_MS = 30000;
const SLOW_REQUEST_NOTICE_MS = 4000;

async function apiRequest(action, data = {}, options = {}) {

    const allowRetry = !NON_IDEMPOTENT_ACTIONS.has(action);
    const maxAttempts = allowRetry ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        const controller = new AbortController();
        const timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
        let slowShown = false;
        const slowTimer = options.silent ? null : setTimeout(function () {
            slowShown = true;
            slowRequestStarted();
        }, SLOW_REQUEST_NOTICE_MS);

        const cleanup = function () {
            clearTimeout(timeoutId);
            if (slowTimer) clearTimeout(slowTimer);
            if (slowShown) slowRequestEnded();
        };

        try {

            // text/plain avoids a CORS pre-flight round trip to Apps Script.
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(Object.assign({ action: action, token: sessionToken }, data)),
                signal: controller.signal,
                redirect: "follow"
            });

            cleanup();

            if (!response.ok) throw new Error("HTTP " + response.status);

            const result = await response.json();

            if (result && result.authError && action !== "login" && action !== "logout") {
                handleSessionExpired();
            }

            return result;

        }
        catch (error) {

            cleanup();

            const isNetworkLevel = error.name === "AbortError" || error instanceof TypeError;

            if (isNetworkLevel && attempt < maxAttempts) {
                await wait(600 * attempt);
                continue;
            }

            console.error("API Error:", action, error);

            const message = error.name === "AbortError"
                ? "The server took too long to answer. Your change may still have saved — refresh before trying again."
                : "Couldn't reach Google Sheets. Check your internet connection and try again.";

            return { success: false, message: message, networkError: isNetworkLevel };

        }

    }

    return { success: false, message: "Unknown error.", networkError: true };

}

/* =========================================================
   SAVING LOADER (small "Saving…" pill)
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
    finally {
        activeRequests.delete(key);
        if (activeRequests.size === 0) hideActionLoader();
    }

}

function showActionLoader(text) {
    const loader = document.getElementById("actionLoader");
    if (!loader) return;
    setText("actionLoaderText", text || "Saving…");
    loader.classList.add("show");
}

function hideActionLoader() {
    document.getElementById("actionLoader")?.classList.remove("show");
}

/* =========================================================
   LOAD ALL DATA (one request)
========================================================= */

function normalizeTasks(data) {

    if (!Array.isArray(data)) return [];

    return data.map(function (task) {
        return {
            taskId: String(task.taskId ?? task["Task ID"] ?? ""),
            task: task.task ?? task["Task"] ?? "",
            description: task.description ?? task["Description"] ?? "",
            department: task.department ?? task["Department"] ?? "",
            assignedTo: task.assignedTo ?? task["Assigned To"] ?? "",
            priority: task.priority ?? task["Priority"] ?? "Medium",
            status: normalizeStatus(task.status ?? task["Status"] ?? "Open"),
            createdDate: formatDateForInput(task.createdDate ?? ""),
            dueDate: formatDateForInput(task.dueDate ?? ""),
            followupDate: formatDateForInput(task.followupDate ?? ""),
            lastAction: task.lastAction ?? "",
            remarks: task.remarks ?? "",
            updatedBy: task.updatedBy ?? "",
            updatedDate: formatDateForInput(task.updatedDate ?? "")
        };
    });

}

function groupByTaskId(list) {
    const map = {};
    (list || []).forEach(function (item) {
        const key = String(item.taskId);
        if (!map[key]) map[key] = [];
        map[key].push(item);
    });
    return map;
}

/* Accepts either the server's bootstrap response or the local cache. */
function applyDataSnapshot(snapshot) {

    if (!snapshot) return;

    if (Array.isArray(snapshot.tasks)) tasks = normalizeTasks(snapshot.tasks).filter(canSeeItem);
    if (Array.isArray(snapshot.regularTasks)) regularTasks = snapshot.regularTasks.filter(canSeeItem);
    if (Array.isArray(snapshot.backlog)) backlogTasks = snapshot.backlog;
    if (Array.isArray(snapshot.users)) setUsers(snapshot.users);

    if (Array.isArray(snapshot.checklists)) allChecklists = groupByTaskId(snapshot.checklists);
    else if (snapshot.checklists && typeof snapshot.checklists === "object") allChecklists = snapshot.checklists;

    if (Array.isArray(snapshot.comments)) allComments = groupByTaskId(snapshot.comments);
    else if (snapshot.comments && typeof snapshot.comments === "object") allComments = snapshot.comments;

    populateRegularTasksDepartmentFilter();

}

async function loadCoreData() {

    // Don't start a second load while one is already running.
    if (coreLoadPromise) return coreLoadPromise;

    coreLoadPromise = (async function () {

        const result = await apiRequest("bootstrap");

        if (!currentUser) return; // logged out meanwhile

        if (result && result.success) {

            applyDataSnapshot(result);

            dataEverLoaded = true;
            dataLoadFailed = false;
            lastLoadedAt = Date.now();
            persistLocalCache();

            const sectionErrors = Object.keys(result.errors || {});
            if (sectionErrors.length) {
                showGlobalStatusBanner("Some sections couldn't load (" + sectionErrors.join(", ") + "). The rest is up to date.",
                    { isError: true, onRetry: loadCoreData });
            } else {
                const banner = document.getElementById("globalStatusBanner");
                if (banner && banner.dataset.kind === "error") hideGlobalStatusBanner();
            }

        } else if (!result?.authError) {

            dataLoadFailed = true;
            showGlobalStatusBanner(
                dataEverLoaded || tasks.length
                    ? "Couldn't refresh just now — you're seeing the last saved data."
                    : "Couldn't load your data. " + (result?.message || ""),
                { isError: true, onRetry: loadCoreData }
            );

        }

        renderCurrentPage();
        refreshOpenDrawers();

    })();

    try {
        await coreLoadPromise;
    } finally {
        coreLoadPromise = null;
    }

}

/* Quietly refresh when someone comes back to the tab after a while. */
function initializeBackgroundRefresh() {

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible" || !currentUser || !sessionToken) return;
        if (Date.now() - lastLoadedAt > 2 * 60 * 1000) loadCoreData();
    });

}

/* Put one task returned by the server into local state. */
function upsertLocalTask(rawTask) {

    if (!rawTask) return;

    const normalized = normalizeTasks([rawTask])[0];
    if (!normalized || !normalized.taskId) return;

    const index = tasks.findIndex(function (t) { return t.taskId === normalized.taskId; });

    if (!canSeeItem(normalized)) {
        if (index !== -1) tasks.splice(index, 1);
    } else if (index !== -1) {
        tasks[index] = normalized;
    } else {
        tasks.unshift(normalized);
    }

    persistLocalCacheSoon();
    renderCurrentPage();

}

/* =========================================================
   OWNER PICKER (multi-select dropdown fed by the Users sheet)
========================================================= */

function setUsers(list) {

    // Deduplicate by display name so the dropdown doesn't list the
    // same name twice.
    const seen = {};
    users = (list || [])
        .filter(function (u) { return u && (u.name || u.username); })
        .map(function (u) { return Object.assign({}, u, { name: String(u.name || u.username).trim() }); })
        .filter(function (u) {
            const key = u.name.toLowerCase();
            if (seen[key]) { seen[key].duplicate = true; u.duplicate = true; return false; }
            seen[key] = u;
            return true;
        })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (taskOwnerPicker) taskOwnerPicker.refresh();
    if (taskDetailOwnerPicker) taskDetailOwnerPicker.refresh();

}

/* Maps a stored name like "Tarun" to the Users-sheet name "Mr.Tarun".
   Returns null if no unique match is found. */
function canonicalUserName(token) {
    const matches = users.filter(function (u) { return ownerMatchesUser(token, u); });
    return matches.length === 1 ? matches[0].name : null;
}

function createOwnerPicker(root) {

    if (!root) return null;

    root.innerHTML = `
        <button type="button" class="owner-picker-trigger" aria-haspopup="listbox" aria-expanded="false">
            <span class="owner-picker-chips"></span>
            <span class="owner-picker-caret" aria-hidden="true">▾</span>
        </button>
        <div class="owner-picker-menu" hidden>
            <input type="search" class="owner-picker-search" placeholder="Search people…" aria-label="Search people">
            <div class="owner-picker-options" role="listbox" aria-multiselectable="true"></div>
            <div class="owner-picker-footer">
                <button type="button" class="owner-picker-clear">Clear</button>
                <button type="button" class="owner-picker-done">Done</button>
            </div>
        </div>
    `;

    const trigger = root.querySelector(".owner-picker-trigger");
    const chips = root.querySelector(".owner-picker-chips");
    const menu = root.querySelector(".owner-picker-menu");
    const search = root.querySelector(".owner-picker-search");
    const optionsBox = root.querySelector(".owner-picker-options");

    let selected = [];      // display names, in pick order
    let disabled = false;

    function renderChips() {
        if (!selected.length) {
            chips.innerHTML = `<span class="owner-picker-placeholder">${disabled ? "Unassigned" : "Select owners"}</span>`;
            return;
        }
        chips.innerHTML = selected.map(function (name) {
            const known = users.some(function (u) { return u.name === name; });
            return `<span class="owner-chip${known ? "" : " owner-chip-unknown"}" title="${known ? "" : "Not in the Users sheet"}">${escapeHtml(name)}</span>`;
        }).join("");
    }

    function renderOptions() {

        const query = normalizePersonName(search.value);
        const names = users.map(function (u) { return u.name; });

        // Keep old names that aren't in the Users sheet visible so they can be removed.
        selected.forEach(function (name) { if (names.indexOf(name) === -1) names.push(name); });

        const visible = names.filter(function (name) { return !query || normalizePersonName(name).indexOf(query) !== -1; });

        if (!users.length) {
            optionsBox.innerHTML = `<div class="owner-picker-empty">No people found. Add them to the Users sheet (with Status "Active").</div>`;
            return;
        }

        if (!visible.length) {
            optionsBox.innerHTML = `<div class="owner-picker-empty">No one matches "${escapeHtml(search.value)}".</div>`;
            return;
        }

        optionsBox.innerHTML = visible.map(function (name) {
            const user = users.find(function (u) { return u.name === name; });
            const checked = selected.indexOf(name) !== -1;
            const hint = user
                ? (user.primaryDepartment && user.primaryDepartment.toLowerCase() !== "all" ? user.primaryDepartment : user.role || "")
                : "Not in Users sheet";
            return `
                <label class="owner-picker-option${checked ? " is-checked" : ""}" role="option" aria-selected="${checked}">
                    <input type="checkbox" value="${escapeHtml(name)}" ${checked ? "checked" : ""}>
                    <span class="owner-picker-option-name">${escapeHtml(name)}</span>
                    <span class="owner-picker-option-hint">${escapeHtml(hint)}</span>
                </label>
            `;
        }).join("");

    }

    function open() {
        if (disabled) return;
        document.querySelectorAll(".owner-picker.is-open").forEach(function (other) {
            if (other !== root && other._picker) other._picker.close();
        });
        menu.hidden = false;
        root.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        search.value = "";
        renderOptions();
        setTimeout(function () { search.focus(); }, 0);
    }

    function close() {
        menu.hidden = true;
        root.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", function () {
        if (root.classList.contains("is-open")) close(); else open();
    });

    search.addEventListener("input", renderOptions);

    search.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.stopPropagation(); close(); trigger.focus(); }
        if (event.key === "Enter") {
            event.preventDefault();
            const first = optionsBox.querySelector("input[type='checkbox']");
            if (first) { first.checked = !first.checked; first.dispatchEvent(new Event("change", { bubbles: true })); }
        }
    });

    optionsBox.addEventListener("change", function (event) {
        const box = event.target;
        if (!box || box.type !== "checkbox") return;
        const name = box.value;
        if (box.checked) { if (selected.indexOf(name) === -1) selected.push(name); }
        else selected = selected.filter(function (n) { return n !== name; });
        renderChips();
        renderOptions();
        root.dispatchEvent(new CustomEvent("ownerschange", { bubbles: true }));
    });

    root.querySelector(".owner-picker-clear").addEventListener("click", function () {
        selected = [];
        renderChips();
        renderOptions();
        root.dispatchEvent(new CustomEvent("ownerschange", { bubbles: true }));
    });

    root.querySelector(".owner-picker-done").addEventListener("click", function () { close(); trigger.focus(); });

    document.addEventListener("mousedown", function (event) {
        if (root.classList.contains("is-open") && !root.contains(event.target)) close();
    });

    const api = {
        getValue: function () { return joinOwners(selected); },
        getList: function () { return selected.slice(); },
        setValue: function (value) {
            // Map old spellings ("Tarun", "bhuvana") onto the Users-sheet names.
            const out = [];
            splitOwners(value).forEach(function (token) {
                const name = canonicalUserName(token) || token;
                if (out.indexOf(name) === -1) out.push(name);
            });
            selected = out;
            renderChips();
            if (!menu.hidden) renderOptions();
        },
        setDisabled: function (value) {
            disabled = !!value;
            trigger.disabled = disabled;
            root.classList.toggle("is-disabled", disabled);
            if (disabled) close();
            renderChips();
        },
        refresh: function () {
            api.setValue(api.getValue());
        },
        close: close
    };

    root._picker = api;
    renderChips();
    return api;

}

function initializeOwnerPickers() {
    taskOwnerPicker = createOwnerPicker(document.getElementById("taskOwnerPicker"));
    taskDetailOwnerPicker = createOwnerPicker(document.getElementById("taskDetailOwnerPicker"));
}

/* =========================================================
   SECTIONS: MY TASKS → OTHERS IN MY DEPARTMENT (collapsible)
========================================================= */

const PRIORITY_SORT_ORDER = { high: 0, medium: 1, low: 2 };

function makeDateThenPriorityComparator(dateField) {

    return function (a, b) {

        const dateA = parseDate(a[dateField]);
        const dateB = parseDate(b[dateField]);

        if (dateA && dateB) {
            const diff = dateA.getTime() - dateB.getTime();
            if (diff !== 0) return diff;
        } else if (dateA && !dateB) {
            return -1;
        } else if (!dateA && dateB) {
            return 1;
        }

        const pa = PRIORITY_SORT_ORDER[String(a.priority || "").toLowerCase()] ?? 99;
        const pb = PRIORITY_SORT_ORDER[String(b.priority || "").toLowerCase()] ?? 99;
        return pa - pb;

    };

}

/* Completed items sink to the bottom of each section. */
function makeSectionComparator(dateField) {
    const byDate = makeDateThenPriorityComparator(dateField);
    return function (a, b) {
        const ca = String(a.status || "").toLowerCase() === "completed" ? 1 : 0;
        const cb = String(b.status || "").toLowerCase() === "completed" ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return byDate(a, b);
    };
}

/* Returns [{ key, title, items, collapsible, emptyText }].
   Admins: "My Tasks" + "All Other Tasks" (both open).
   Everyone else: "My Tasks" + "Others in <primary dept>" (collapsed). */
function buildSections(items, options = {}) {

    const comparator = makeSectionComparator(options.dateField || "dueDate");
    const mine = [];
    const others = [];

    items.forEach(function (item) {
        if (currentUserMatches(item.assignedTo)) mine.push(item);
        else others.push(item);
    });

    mine.sort(comparator);
    others.sort(comparator);

    const sections = [];
    const privileged = isPrivilegedUser();

    sections.push({
        key: "mine",
        title: "My Tasks",
        items: mine,
        collapsible: false,
        emptyText: options.mineEmptyText || "Nothing is assigned to you here."
    });

    if (privileged) {
        if (others.length) {
            sections.push({ key: "others", title: "All Other Tasks", items: others, collapsible: false });
        }
    } else if (others.length) {
        const primary = primaryDepartment();
        sections.push({
            key: "others",
            title: primary ? `Others in ${primary}` : "Other tasks",
            items: others,
            collapsible: true
        });
    }

    return sections;

}

function isSectionExpanded(pageKey, section) {
    if (!section.collapsible) return true;
    return !!expandedSections[pageKey + ":" + section.key];
}

function toggleSection(pageKey, sectionKey) {
    const key = pageKey + ":" + sectionKey;
    expandedSections[key] = !expandedSections[key];
    renderCurrentPage();
}

function sectionToggleButton(pageKey, section, expanded) {
    return `
        <button type="button" class="section-toggle" data-page-key="${escapeHtml(pageKey)}" data-section-key="${escapeHtml(section.key)}" aria-expanded="${expanded}">
            <span class="section-toggle-caret" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            ${expanded ? "Hide" : "Show"} ${section.items.length} task${section.items.length === 1 ? "" : "s"}
        </button>
    `;
}

/* =========================================================
   DASHBOARD
========================================================= */

function countStatus(list, status) {
    return list.filter(function (t) { return t.status === status; }).length;
}

function updateDashboard() {

    animateNumber("totalTasks", tasks.length);
    animateNumber("openTasks", countStatus(tasks, "Open"));
    animateNumber("progressTasks", countStatus(tasks, "In Progress"));
    animateNumber("onHoldTasks", countStatus(tasks, STATUS_ON_HOLD));
    animateNumber("completedTasks", countStatus(tasks, "Completed"));
    animateNumber("overdueTasks", tasks.filter(isOverdue).length);

    animateNumber("highPriorityCount", tasks.filter(function (t) { return t.priority === "High"; }).length);
    animateNumber("mediumPriorityCount", tasks.filter(function (t) { return t.priority === "Medium"; }).length);
    animateNumber("lowPriorityCount", tasks.filter(function (t) { return t.priority === "Low"; }).length);

    updateFollowupSummary();
    renderRecentTasks();

}

function animateNumber(id, value) {

    const element = document.getElementById(id);
    if (!element) return;

    const target = Number(value) || 0;
    const start = Number(element.textContent) || 0;

    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        element.textContent = target;
        return;
    }

    const duration = 450;
    const startTime = performance.now();

    function tick(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else element.textContent = target;
    }

    requestAnimationFrame(tick);

}

function renderRecentTasks() {

    const tbody = document.getElementById("recentTasksTable");
    if (!tbody) return;

    const recent = tasks.slice()
        .sort(function (a, b) { return String(b.updatedDate).localeCompare(String(a.updatedDate)); })
        .slice(0, 10);

    tbody.innerHTML = "";

    if (!recent.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">${dataEverLoaded ? "No tasks yet." : "Loading tasks…"}</td></tr>`;
        return;
    }

    batchRows(tbody, recent, function (task) {
        const row = document.createElement("tr");
        row.className = "row-clickable" + (isDueSoon(task) ? " row-due-soon" : "");
        row.dataset.id = task.taskId;
        row.innerHTML = `
            <td>${escapeHtml(task.taskId)}</td>
            <td>${escapeHtml(task.task)}</td>
            <td>${escapeHtml(task.department)}</td>
            <td class="owners-cell">${ownersDisplay(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${dueDateWithChip(task)}</td>
        `;
        return row;
    });

}

/* =========================================================
   ALL TASKS
========================================================= */

function buildTaskRow(task, options = {}) {

    const row = document.createElement("tr");
    row.className = "row-clickable" + (isDueSoon(task) ? " row-due-soon" : "") + (options.extraClass ? " " + options.extraClass : "");
    row.dataset.id = task.taskId;

    const actionCell = isPrivilegedUser()
        ? `<button type="button" class="table-action edit-task" data-id="${escapeHtml(task.taskId)}">Edit</button>`
        : `<span class="table-action-view">View</span>`;

    if (options.variant === "department") {
        row.innerHTML = `
            <td>${escapeHtml(task.taskId)}</td>
            <td>${escapeHtml(task.task)}</td>
            <td class="owners-cell">${ownersDisplay(task.assignedTo)}</td>
            <td>${priorityBadge(task.priority)}</td>
            <td>${statusBadge(task.status, task)}</td>
            <td>${dueDateWithChip(task)}</td>
            <td>${displayDate(task.followupDate)}</td>
            <td class="checklist-cell">${checklistStatusDot(task.taskId)}</td>
            <td>${actionCell}</td>
        `;
        return row;
    }

    row.innerHTML = `
        <td>${escapeHtml(task.taskId)}</td>
        <td><strong>${escapeHtml(task.task)}</strong></td>
        <td>${escapeHtml(task.department)}</td>
        <td class="owners-cell">${ownersDisplay(task.assignedTo)}</td>
        <td>${priorityBadge(task.priority)}</td>
        <td>${statusBadge(task.status, task)}</td>
        <td>${dueDateWithChip(task)}</td>
        <td class="checklist-cell">${checklistStatusDot(task.taskId)}</td>
        <td>${actionCell}</td>
    `;

    return row;

}

function renderSectionedTable(tbody, items, pageKey, colspan, rowOptions, forceExpand) {

    const sections = buildSections(items, rowOptions.sectionOptions || {});
    const fragment = document.createDocumentFragment();

    sections.forEach(function (section) {

        const expanded = forceExpand || isSectionExpanded(pageKey, section);

        const header = document.createElement("tr");
        header.className = "table-section-row" + (section.collapsible ? " table-section-row-collapsible" : "");
        header.innerHTML = `
            <td colspan="${colspan}">
                <div class="table-section-header">
                    <span>${escapeHtml(section.title)}</span>
                    <span class="table-section-count">${section.items.length}</span>
                    ${section.collapsible && !forceExpand ? sectionToggleButton(pageKey, section, expanded) : ""}
                </div>
            </td>
        `;
        fragment.appendChild(header);

        if (!expanded) return;

        if (!section.items.length) {
            const empty = document.createElement("tr");
            empty.innerHTML = `<td colspan="${colspan}" class="empty-table empty-table-compact">${escapeHtml(section.emptyText || "Nothing here.")}</td>`;
            fragment.appendChild(empty);
            return;
        }

        section.items.forEach(function (task) {
            fragment.appendChild(buildTaskRow(task, Object.assign({}, rowOptions, {
                extraClass: section.collapsible ? "row-others" : ""
            })));
        });

    });

    tbody.appendChild(fragment);

}

function renderTasksTable() {

    const tbody = document.getElementById("allTasksTable");
    if (!tbody) return;

    const search = document.getElementById("taskSearch")?.value?.trim().toLowerCase() || "";
    const department = getInput("departmentFilter");
    const priority = getInput("priorityFilter");
    const status = getInput("statusFilter");

    const noActiveFilters = !search && !department && !priority && !status;

    const filtered = tasks.filter(function (task) {

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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-table">${dataEverLoaded || !noActiveFilters ? "No matching tasks." : "Loading tasks…"}</td></tr>`;
        return;
    }

    // Admins who search/filter get one flat list. Everyone else always sees
    // My Tasks + Others; a text search opens the Others section automatically
    // so matches there aren't hidden.
    if (isPrivilegedUser() && !noActiveFilters) {
        batchRows(tbody, filtered.slice().sort(makeSectionComparator("dueDate")), function (task) { return buildTaskRow(task); });
        return;
    }

    renderSectionedTable(tbody, filtered, "tasks", 9, {}, !!search);

}

let tableDelegationReady = false;

function initializeTableDelegation() {

    if (tableDelegationReady) return;
    tableDelegationReady = true;

    ["allTasksTable", "departmentTasksTable", "recentTasksTable"].forEach(function (id) {

        const tbody = document.getElementById(id);
        if (!tbody) return;

        tbody.addEventListener("click", function (event) {

            const toggle = event.target.closest(".section-toggle");
            if (toggle) {
                event.stopPropagation();
                toggleSection(toggle.dataset.pageKey, toggle.dataset.sectionKey);
                return;
            }

            const editButton = event.target.closest(".edit-task");
            if (editButton) {
                event.stopPropagation();
                editTask(editButton.dataset.id);
                return;
            }

            const row = event.target.closest(".row-clickable");
            if (row && row.dataset.id) openTaskDetailDrawer(row.dataset.id);

        });

    });

}

/* =========================================================
   FOLLOW-UPS
========================================================= */

function updateFollowupSummary() {

    const today = startOfToday();

    const todayCount = tasks.filter(function (t) { return t.followupDate && sameDate(t.followupDate, today); }).length;
    const overdue = tasks.filter(function (t) { return t.followupDate && dateBeforeToday(t.followupDate); }).length;
    const upcoming = tasks.filter(function (t) {
        const date = parseDate(t.followupDate);
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

    const followups = tasks
        .filter(function (t) { return t.followupDate; })
        .sort(function (a, b) { return String(a.followupDate).localeCompare(String(b.followupDate)); });

    tbody.innerHTML = "";

    if (!followups.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-table">No follow-ups scheduled.</td></tr>`;
        return;
    }

    batchRows(tbody, followups, function (task) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(task.taskId)}</td>
            <td>${escapeHtml(task.task)}</td>
            <td>${escapeHtml(task.department)}</td>
            <td class="owners-cell">${ownersDisplay(task.assignedTo)}</td>
            <td>${displayDate(task.followupDate)}</td>
            <td>${escapeHtml(task.lastAction || "-")}</td>
            <td>${statusBadge(task.status, task)}</td>
        `;
        return row;
    });

}

/* =========================================================
   DEPARTMENTS
========================================================= */

function openDepartment(department) {
    currentDepartment = department;
    currentPage = "department";
    document.querySelectorAll(".nav-item").forEach(function (item) {
        item.classList.toggle("active", item.dataset.department === department);
    });
    showDepartmentPage(department);
}

function showDepartmentPage(department) {

    currentDepartment = department;

    document.querySelectorAll(".page").forEach(function (s) { s.classList.remove("active-page"); });
    document.getElementById("departmentDetailPage")?.classList.add("active-page");

    setText("pageTitle", department);
    setText("pageSubtitle", "Department operational overview");
    setText("departmentDetailCode", getDepartmentCode(department));
    setText("departmentDetailTitle", department);
    setText("departmentDetailSubtitle", "Department operational overview.");
    setText("departmentTasksScopeText", isPrivilegedUser()
        ? "Tasks assigned to this department."
        : "Tasks in this department that you can see.");

    const list = tasks.filter(function (t) { return t.department === department; });

    setText("departmentTotal", list.length);
    setText("departmentOpen", countStatus(list, "Open"));
    setText("departmentProgress", countStatus(list, "In Progress"));
    setText("departmentOnHold", countStatus(list, STATUS_ON_HOLD));
    setText("departmentCompleted", countStatus(list, "Completed"));
    setText("departmentOverdue", list.filter(isOverdue).length);

    const tbody = document.getElementById("departmentTasksTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-table">No tasks you can see in this department.</td></tr>`;
        return;
    }

    renderSectionedTable(tbody, list, "department:" + department, 9, { variant: "department" }, false);

}

function renderDepartmentCards() {

    const container = document.getElementById("departmentsGrid");
    if (!container) return;

    container.innerHTML = DEPARTMENTS.map(function (department) {
        const list = tasks.filter(function (t) { return t.department === department; });
        return `
            <div class="department-card">
                <div class="department-card-code">${getDepartmentCode(department)}</div>
                <h3>${escapeHtml(department)}</h3>
                <div class="department-card-stats">
                    <div><strong>${list.length}</strong><span>Total</span></div>
                    <div><strong>${countStatus(list, "Completed")}</strong><span>Completed</span></div>
                    <div><strong>${countStatus(list, STATUS_ON_HOLD)}</strong><span>On Hold</span></div>
                    <div><strong>${list.filter(isOverdue).length}</strong><span>Overdue</span></div>
                </div>
                <button class="secondary-button department-view-button" data-department="${escapeHtml(department)}">View Department</button>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".department-view-button").forEach(function (button) {
        button.addEventListener("click", function () { openDepartment(button.dataset.department); });
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

    const activities = tasks.slice()
        .sort(function (a, b) { return String(b.updatedDate).localeCompare(String(a.updatedDate)); })
        .slice(0, 20);

    container.innerHTML = activities.map(function (task) {
        return `
            <div class="activity-item">
                <div class="activity-dot"></div>
                <div class="activity-content">
                    <strong>${escapeHtml(task.task)}</strong>
                    <p>${escapeHtml(task.status)} · ${escapeHtml(task.department)}</p>
                    <small>Updated by ${escapeHtml(task.updatedBy || "System")} · ${escapeHtml(displayDate(task.updatedDate))}</small>
                </div>
            </div>
        `;
    }).join("");

}

/* =========================================================
   TASK MODAL
========================================================= */

let editingTaskId = "";

function initializeTaskButtons() {

    ["topAddTask", "dashboardAddTask", "tasksAddButton", "departmentAddTaskButton"].forEach(function (id) {
        document.getElementById(id)?.addEventListener("click", function () { openTaskModal(); });
    });

    document.getElementById("closeTaskModal")?.addEventListener("click", closeTaskModal);
    document.getElementById("cancelTaskButton")?.addEventListener("click", closeTaskModal);

    const overlay = document.getElementById("taskModal");
    overlay?.addEventListener("click", function (event) {
        if (event.target === overlay) closeTaskModal();
    });

}

function initializeKeyboardShortcuts() {

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        if (document.querySelector(".owner-picker.is-open")) {
            document.querySelectorAll(".owner-picker.is-open").forEach(function (p) { p._picker?.close(); });
            return;
        }
        closeAllOverlays();
    });

}

function closeAllOverlays() {
    closeTaskModal();
    closeRegularTaskUpdate();
    closeBacklogItemModal();
    closeBacklogDetailDrawer();
    closeRegularTaskChecklistDrawer();
    if (taskDetailCurrentId) closeTaskDetailDrawer();
}

function initializeTaskForm() {
    document.getElementById("taskForm")?.addEventListener("submit", async function (event) {
        event.preventDefault();
        await saveTask();
    });
}

function showTaskFormError(message) {
    const box = document.getElementById("taskFormError");
    if (!box) return;
    box.textContent = message || "";
    box.style.display = message ? "block" : "none";
}

function openTaskModal(task = null) {

    const modal = document.getElementById("taskModal");
    if (!modal) return;

    showTaskFormError("");

    if (task) {
        editingTaskId = task.taskId;
        setText("taskModalTitle", "Edit Task");
        populateTaskForm(task);
    } else {
        editingTaskId = "";
        setText("taskModalTitle", "Add New Task");
        clearTaskForm();
        if (currentPage === "department" && currentDepartment) setInput("taskDepartment", currentDepartment);
        else if (currentPage === "bookFair") setInput("taskDepartment", "Book Fair - Events");
        // Default a new task to its creator.
        if (taskOwnerPicker && currentUser) taskOwnerPicker.setValue(currentUser.name || currentUser.username);
    }

    modal.style.display = "flex";
    document.body.classList.add("modal-open");
    setTimeout(function () { document.getElementById("taskName")?.focus(); }, 50);

}

function closeTaskModal() {
    const modal = document.getElementById("taskModal");
    if (modal && modal.style.display !== "none") {
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
    }
    taskOwnerPicker?.close();
    editingTaskId = "";
}

function clearTaskForm() {
    document.getElementById("taskForm")?.reset();
    setInput("editTaskId", "");
    setInput("taskPriority", "Medium");
    setInput("taskStatus", "Open");
    setInput("taskCreatedDate", todayInput());
    taskOwnerPicker?.setValue("");
}

function populateTaskForm(task) {
    setInput("editTaskId", task.taskId);
    setInput("taskName", task.task);
    setInput("taskDescription", task.description);
    setInput("taskDepartment", task.department);
    setInput("taskPriority", task.priority);
    setInput("taskStatus", task.status);
    setInput("taskCreatedDate", task.createdDate);
    setInput("taskDueDate", task.dueDate);
    setInput("taskFollowupDate", task.followupDate);
    setInput("taskFollowupAction", task.lastAction);
    setInput("taskRemarks", task.remarks);
    taskOwnerPicker?.setValue(task.assignedTo);
}

async function saveTask() {

    if (isRequestActive("saveTask")) return;

    const submitButton = document.querySelector("#taskForm .primary-button");
    setButtonLoading(submitButton, true);

    try {
        await guardAsync("saveTask", saveTaskRequest);
    } finally {
        setButtonLoading(submitButton, false);
    }

}

async function saveTaskRequest() {

    const editId = getInput("editTaskId");

    const task = {
        taskId: editId,
        task: getInput("taskName").trim(),
        description: getInput("taskDescription"),
        department: getInput("taskDepartment"),
        assignedTo: taskOwnerPicker ? taskOwnerPicker.getValue() : "",
        priority: getInput("taskPriority") || "Medium",
        status: getInput("taskStatus") || "Open",
        dueDate: getInput("taskDueDate"),
        followupDate: getInput("taskFollowupDate"),
        lastAction: getInput("taskFollowupAction"),
        remarks: getInput("taskRemarks")
    };

    if (!task.task) return showTaskFormError("Enter a task name.");
    if (!task.department) return showTaskFormError("Choose a department.");
    if (!task.assignedTo) return showTaskFormError("Choose at least one owner.");
    if (!task.dueDate) return showTaskFormError("Pick a due date.");

    showTaskFormError("");

    const result = await apiRequest(editId ? "updateTask" : "createTask", { task: task });

    if (!result || !result.success) {
        showTaskFormError(result?.message || "Couldn't save the task. Try again.");
        return;
    }

    closeTaskModal();
    showNotification("Saved", editId ? "Task updated." : "Task created.");
    upsertLocalTask(result.task);

}

function editTask(taskId) {
    const task = tasks.find(function (t) { return t.taskId === taskId; });
    if (!task) return showNotification("Error", "Task not found.");
    openTaskModal(task);
}

/* =========================================================
   FILTERS / EXPORT
========================================================= */

function initializeFilters() {

    const debouncedRender = debounce(renderTasksTable, 180);

    document.getElementById("taskSearch")?.addEventListener("input", debouncedRender);

    ["departmentFilter", "priorityFilter", "statusFilter"].forEach(function (id) {
        document.getElementById(id)?.addEventListener("change", renderTasksTable);
    });

}

function initializeExports() {
    document.getElementById("exportTasksButton")?.addEventListener("click", exportTasksCSV);
}

function exportTasksCSV() {

    if (!tasks.length) return showNotification("Export", "There are no tasks to export.");

    const headers = ["Task ID", "Department", "Task", "Description", "Owners", "Priority", "Status",
        "Created Date", "Due Date", "Follow-up Date", "Last Action", "Remarks", "Updated By", "Updated Date"];

    const rows = tasks.map(function (t) {
        return [t.taskId, t.department, t.task, t.description, t.assignedTo, t.priority, t.status,
            t.createdDate, t.dueDate, t.followupDate, t.lastAction, t.remarks, t.updatedBy, t.updatedDate];
    });

    const csv = [headers].concat(rows).map(function (row) { return row.map(csvEscape).join(","); }).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "Excelso_Operations_Tasks.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

}

/* =========================================================
   DATES
   Handles yyyy-MM-dd, MM-dd-yyyy, M/d/yyyy and MM-dd-yy (the
   formats found in the sheet). Safari can't parse "09-30-2026"
   on its own, which made due dates disappear there.
========================================================= */

function parseDate(value) {

    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());

    const text = String(value).trim();

    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

    m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(\s|$)/);
    if (m) {
        let a = Number(m[1]), b = Number(m[2]), year = Number(m[3]);
        if (year < 100) year += 2000;
        let month = a, day = b;
        if (a > 12 && b <= 12) { month = b; day = a; }
        const date = new Date(year, month - 1, day);
        return isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return isNaN(date.getTime()) ? null : date;

}

function formatDateForInput(value) {
    if (!value) return "";
    const date = parseDate(value);
    if (!date) return String(value);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function displayDate(value) {
    if (!value) return "-";
    const date = parseDate(value);
    if (!date) return escapeHtml(value);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayInput() { return formatDateForInput(new Date()); }

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function sameDate(value, date) {
    const parsed = parseDate(value);
    return !!parsed && parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate();
}

function dateBeforeToday(value) {
    const date = parseDate(value);
    if (!date) return false;
    date.setHours(0, 0, 0, 0);
    return date < startOfToday();
}

function isOverdue(task) {
    if (!task.dueDate || task.status === "Completed") return false;
    return dateBeforeToday(task.dueDate);
}

function isDueSoon(task, dateField = "dueDate") {
    if (!task || task.status === "Completed") return false;
    const date = parseDate(task[dateField]);
    if (!date) return false;
    date.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date.getTime() - startOfToday().getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 3;
}

function dueDateWithChip(task, dateField = "dueDate") {
    const formatted = displayDate(task[dateField]);
    return isDueSoon(task, dateField) ? `${formatted} <span class="due-soon-chip">Due Soon</span>` : formatted;
}

/* =========================================================
   BADGES / MISC
========================================================= */

function priorityBadge(priority) {
    return `<span class="priority-badge priority-${escapeHtml(String(priority || "").toLowerCase())}">${escapeHtml(priority || "-")}</span>`;
}

function statusBadge(status, task) {
    let display = normalizeStatus(status);
    if (display !== "Completed" && task && isOverdue(task)) display = "Overdue";
    return `<span class="status-badge status-${escapeHtml(display.toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(display)}</span>`;
}

function getDepartmentCode(department) {
    const codes = {
        "B2B - Sales": "B2B", "Customer Support": "CS", "Warehouse": "WH", "Scanning - Catalog": "SC",
        "Listing - Inventory": "LI", "Digital Marketing": "DM", "IT - Software Development": "IT",
        "Finance": "FN", "Book Fair - Events": "BF", "Books and Supply Procurement": "BP", "HR": "HR",
        "Data Analysis": "DA", "Software Testing": "ST", "Product Development": "PD"
    };
    return codes[department] || "DP";
}

function showNotification(title, message) {

    const notification = document.getElementById("notification");
    if (!notification) return;

    setText("notificationTitle", title);
    setText("notificationMessage", message);

    notification.classList.remove("show");
    void notification.offsetWidth; // restart animation
    notification.classList.add("show");

    clearTimeout(showNotification._timer);
    showNotification._timer = setTimeout(function () { notification.classList.remove("show"); }, 3500);

}

/* =========================================================
   REGULAR TASKS
   Admins: department filter + everything grouped by frequency.
   Everyone else: "My Regular Tasks" + collapsible
   "Others in <my department>".
========================================================= */

function initializeRegularTasksPage() {

    document.getElementById("regularTasksDepartmentFilter")?.addEventListener("change", renderRegularTasks);

    const container = document.getElementById("regularTasksContainer");
    if (!container) return;

    container.addEventListener("click", function (event) {

        const toggle = event.target.closest(".section-toggle");
        if (toggle) {
            toggleSection(toggle.dataset.pageKey, toggle.dataset.sectionKey);
            return;
        }

        const checklistButton = event.target.closest(".regular-task-checklist-button");
        if (checklistButton) {
            openRegularTaskChecklistDrawer(checklistButton.dataset.regularTaskId);
            return;
        }

        const updateButton = event.target.closest(".regular-task-update-button");
        if (updateButton) openRegularTaskUpdate(updateButton.dataset.regularTaskId);

    });

}

function populateRegularTasksDepartmentFilter() {

    const select = document.getElementById("regularTasksDepartmentFilter");
    if (!select) return;

    const previous = select.value;
    const departments = Array.from(new Set(regularTasks
        .map(function (t) { return String(t.department || "").trim(); })
        .filter(Boolean))).sort();

    select.innerHTML = `<option value="">All Departments</option>` +
        departments.map(function (d) { return `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; }).join("");

    if (previous && departments.indexOf(previous) !== -1) select.value = previous;

}

function frequencyGroup(expectedTime) {
    const f = String(expectedTime || "").trim().toLowerCase();
    if (!f) return "Other";
    if (f.indexOf("daily") !== -1 || f === "everyday" || f === "every day") return "Daily";
    if (f.indexOf("twice") !== -1 && f.indexOf("week") !== -1) return "Twice a Week";
    if (f.indexOf("week") !== -1) return "Weekly";
    if (f.indexOf("month") !== -1) return "Monthly";
    return "Other";
}

function regularGroupsHtml(list) {

    const groups = {};
    list.forEach(function (task) {
        const group = frequencyGroup(task.expectedTime);
        (groups[group] = groups[group] || []).push(task);
    });

    const comparator = makeSectionComparator("expectedDate");

    return ["Daily", "Twice a Week", "Weekly", "Monthly", "Other"].map(function (name) {
        const group = groups[name];
        if (!group || !group.length) return "";
        group.sort(comparator);
        return `
            <div class="regular-task-group">
                <div class="regular-task-group-header">
                    <h2>${escapeHtml(name)}</h2>
                    <span>${group.length} task${group.length === 1 ? "" : "s"}</span>
                </div>
                <div class="regular-task-list">${group.map(createRegularTaskCard).join("")}</div>
            </div>
        `;
    }).join("");

}

function renderRegularTasks() {

    const container = document.getElementById("regularTasksContainer");
    if (!container) return;

    if (!regularTasks.length) {
        container.innerHTML = dataEverLoaded
            ? `<div class="regular-tasks-empty">No regular tasks for you yet.</div>`
            : `<div class="skeleton-card-grid">${skeletonCards(4)}</div>`;
        return;
    }

    if (isPrivilegedUser()) {

        const filter = getInput("regularTasksDepartmentFilter");
        const scoped = filter ? regularTasks.filter(function (t) { return String(t.department || "").trim() === filter; }) : regularTasks;

        if (!scoped.length) {
            container.innerHTML = `<div class="regular-tasks-empty">No regular tasks in ${escapeHtml(filter)} yet.</div>`;
            return;
        }

        const mine = scoped.filter(function (t) { return currentUserMatches(t.assignedTo); });
        const rest = scoped.filter(function (t) { return !currentUserMatches(t.assignedTo); });

        container.innerHTML =
            (mine.length ? `<div class="section-block"><div class="grid-section-header"><span>My Regular Tasks</span><span class="table-section-count">${mine.length}</span></div>${regularGroupsHtml(mine)}</div>` : "") +
            (rest.length ? `<div class="section-block"><div class="grid-section-header"><span>${mine.length ? "Everyone Else" : "All Regular Tasks"}</span><span class="table-section-count">${rest.length}</span></div>${regularGroupsHtml(rest)}</div>` : "");
        return;

    }

    const sections = buildSections(regularTasks, {
        dateField: "expectedDate",
        mineEmptyText: "No regular tasks are assigned to you."
    });

    container.innerHTML = sections.map(function (section) {

        const expanded = isSectionExpanded("regular", section);
        const title = section.key === "mine" ? "My Regular Tasks" : section.title;

        const header = `
            <div class="grid-section-header${section.collapsible ? " grid-section-header-collapsible" : ""}">
                <span>${escapeHtml(title)}</span>
                <span class="table-section-count">${section.items.length}</span>
                ${section.collapsible ? sectionToggleButton("regular", section, expanded) : ""}
            </div>
        `;

        if (!expanded) return `<div class="section-block">${header}</div>`;

        const body = section.items.length
            ? regularGroupsHtml(section.items)
            : `<div class="regular-tasks-empty">${escapeHtml(section.emptyText)}</div>`;

        return `<div class="section-block${section.collapsible ? " section-block-others" : ""}">${header}${body}</div>`;

    }).join("");

}

function createRegularTaskCard(task) {

    const id = String(task.regularTaskId || "").trim();
    const expectedDate = String(task.expectedDate || "").trim();
    const dueSoon = isDueSoon(task, "expectedDate");

    return `
        <div class="regular-task-card${dueSoon ? " card-due-soon" : ""}" data-regular-task-id="${escapeHtml(id)}">
            <div class="regular-task-card-main">
                <div class="regular-task-id">${escapeHtml(id)}</div>
                <h3>${escapeHtml(task.task)}</h3>
                <div class="regular-task-details">
                    ${task.department ? `<span>Department: ${escapeHtml(task.department)}</span>` : ""}
                    <span class="regular-task-owners">Owners: ${ownersDisplay(task.assignedTo)}</span>
                    ${task.priority ? `<span>Priority: ${escapeHtml(task.priority)}</span>` : ""}
                    ${task.expectedTime ? `<span>Expected: ${escapeHtml(task.expectedTime)}</span>` : ""}
                    ${expectedDate ? `<span>Expected Date: ${displayDate(expectedDate)}${dueSoon ? ` <span class="due-soon-chip">Due Soon</span>` : ""}</span>` : ""}
                </div>
            </div>
            <div class="regular-task-card-actions">
                <button type="button" class="regular-task-checklist-button" data-regular-task-id="${escapeHtml(id)}">
                    ${checklistStatusDot(id)} Checklist
                </button>
                <button type="button" class="regular-task-update-button" data-regular-task-id="${escapeHtml(id)}">Update</button>
            </div>
        </div>
    `;

}

function findRegularTask(regularTaskId) {
    return regularTasks.find(function (item) {
        return String(item.regularTaskId || "").trim() === String(regularTaskId || "").trim();
    });
}

function openRegularTaskUpdate(regularTaskId) {

    const task = findRegularTask(regularTaskId);
    if (!task) return showNotification("Error", "Regular task could not be found.");

    const modal = document.getElementById("regularTaskUpdateModal");
    if (!modal) return;

    setText("regularTaskUpdateTaskName", task.task || "Regular Task");
    setText("regularTaskUpdateTaskId", task.regularTaskId || "-");
    setText("regularTaskUpdateDepartment", task.department || "-");
    setText("regularTaskUpdateExpectedTime", task.expectedTime || "-");

    const form = document.getElementById("regularTaskUpdateForm");
    if (form) form.dataset.regularTaskId = task.regularTaskId || "";

    setInput("regularTaskStatus", "");
    setInput("regularTaskDescription", "");

    const error = document.getElementById("regularTaskUpdateError");
    if (error) { error.textContent = ""; error.style.display = "none"; }

    modal.style.display = "flex";
    document.body.classList.add("modal-open");

}

function closeRegularTaskUpdate() {
    const modal = document.getElementById("regularTaskUpdateModal");
    if (modal && modal.style.display !== "none") {
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
    }
}

function initializeRegularTaskUpdateForm() {

    const form = document.getElementById("regularTaskUpdateForm");
    if (!form) return;

    form.addEventListener("submit", async function (event) {

        event.preventDefault();

        const regularTaskId = String(form.dataset.regularTaskId || "").trim();
        const status = getInput("regularTaskStatus");
        const description = getInput("regularTaskDescription").trim();
        const error = document.getElementById("regularTaskUpdateError");

        const fail = function (message) {
            if (error) { error.textContent = message; error.style.display = "block"; }
        };

        if (!regularTaskId) return fail("Regular Task ID is missing.");
        if (status !== "Completed" && status !== "Pending") return fail("Select Completed or Pending.");
        if (!description) return fail("Describe what was done.");

        const guardKey = "regularTaskUpdate-" + regularTaskId;
        if (isRequestActive(guardKey)) return;

        const button = document.getElementById("saveRegularTaskUpdateButton");
        setButtonLoading(button, true);

        try {

            let result = null;
            await guardAsync(guardKey, async function () {
                result = await apiRequest("saveRegularTaskUpdate", { regularTaskId: regularTaskId, status: status, description: description });
            });

            if (!result || !result.success) return fail(result?.message || "Couldn't save the update. Try again.");

            closeRegularTaskUpdate();
            showNotification("Updated", "Regular task update saved.");

        }
        finally {
            setButtonLoading(button, false);
        }

    });

}

function openRegularTaskChecklistDrawer(regularTaskId) {

    const task = findRegularTask(regularTaskId);
    if (!task) return showNotification("Error", "Regular task could not be found.");

    regularTaskChecklistCurrentId = task.regularTaskId;

    setText("regularTaskChecklistTitle", task.task || "Regular Task");
    setText("regularTaskChecklistDepartment", task.department || "-");
    setText("regularTaskChecklistExpectedTime", task.expectedTime || "-");

    refreshRegularTaskChecklistDrawer();

    document.getElementById("regularTaskChecklistDrawer").style.display = "block";
    document.body.classList.add("modal-open");

}

function refreshRegularTaskChecklistDrawer() {

    if (!regularTaskChecklistCurrentId) return;

    const id = regularTaskChecklistCurrentId;

    renderChecklistInto(id,
        document.getElementById("regularTaskChecklistList"),
        document.getElementById("regularTaskChecklistForm"),
        document.getElementById("regularTaskChecklistInput"),
        { canAdd: true, canDelete: isPrivilegedUser(), progressElement: document.getElementById("regularTaskChecklistProgress") });

}

function closeRegularTaskChecklistDrawer() {
    const drawer = document.getElementById("regularTaskChecklistDrawer");
    if (drawer && drawer.style.display !== "none") {
        drawer.style.display = "none";
        document.body.classList.remove("modal-open");
        regularTaskChecklistCurrentId = "";
        if (currentPage === "regularTasks") renderRegularTasks();
    }
}

/* =========================================================
   CHECKLISTS
   Ticks / adds / deletes show instantly and save in the
   background; if the save fails the change is undone and a
   message is shown. The server sends back the task's full,
   fresh checklist with every reply, so no second request.
========================================================= */

function getChecklist(taskId) {
    return allChecklists[String(taskId)] || [];
}

function checklistStatusDot(taskId) {

    const items = getChecklist(taskId);

    if (!items.length) return `<span class="checklist-dot checklist-dot-red" title="No checklist yet"></span>`;

    const done = items.filter(function (i) { return String(i.status).toLowerCase() === "completed"; }).length;

    if (done === items.length) return `<span class="checklist-dot checklist-dot-green" title="Checklist complete"></span>`;

    return `<span class="checklist-dot checklist-dot-red" title="${done}/${items.length} done"></span>`;

}

function updateChecklistProgressLabel(taskId, element) {
    if (!element) return;
    const items = getChecklist(taskId);
    const done = items.filter(function (i) { return String(i.status).toLowerCase() === "completed"; }).length;
    element.textContent = done + "/" + items.length;
}

/* Re-renders every place a checklist might currently be showing. */
function onChecklistChanged() {
    persistLocalCacheSoon();
    if (taskDetailCurrentId) renderTaskDetailChecklist();
    if (regularTaskChecklistCurrentId) refreshRegularTaskChecklistDrawer();
    if (currentPage === "bookFair") refreshBookFairChecklists();
    if (currentPage === "tasks") renderTasksTable();
    if (currentPage === "department" && currentDepartment) showDepartmentPage(currentDepartment);
}

async function addChecklistItem(taskId, text) {

    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    const key = String(taskId);
    const temp = { checklistId: tempId("cl"), taskId: key, item: trimmed, status: "Pending", pending: true };

    allChecklists[key] = getChecklist(key).concat([temp]);
    onChecklistChanged();

    const result = await apiRequest("addChecklistItem", { taskId: key, item: trimmed });

    if (result && result.success && Array.isArray(result.checklists)) {
        allChecklists[key] = result.checklists;
    } else {
        allChecklists[key] = getChecklist(key).filter(function (i) { return i.checklistId !== temp.checklistId; });
        showNotification("Not saved", result?.message || "Couldn't add the checklist item.");
    }

    onChecklistChanged();

}

async function toggleChecklistItem(taskId, itemId) {

    const key = String(taskId);
    const item = getChecklist(key).find(function (i) { return i.checklistId === itemId; });
    if (!item || item.pending) return;

    const previous = item.status;
    const next = String(previous).toLowerCase() === "completed" ? "Pending" : "Completed";

    item.status = next;
    item.pending = true;
    onChecklistChanged();

    const result = await apiRequest("updateChecklistStatus", { checklistId: itemId, status: next });

    if (result && result.success && Array.isArray(result.checklists)) {
        allChecklists[key] = result.checklists;
    } else {
        item.status = previous;
        item.pending = false;
        showNotification("Not saved", result?.message || "Couldn't update the checklist item.");
    }

    onChecklistChanged();

}

async function removeChecklistItem(taskId, itemId) {

    if (!isPrivilegedUser()) {
        return showNotification("Not allowed", "Only the Founder or Operations Head can delete checklist items.");
    }

    const key = String(taskId);
    const before = getChecklist(key).slice();
    const item = before.find(function (i) { return i.checklistId === itemId; });
    if (!item || item.pending) return;

    allChecklists[key] = before.filter(function (i) { return i.checklistId !== itemId; });
    onChecklistChanged();

    const result = await apiRequest("deleteChecklistItem", { checklistId: itemId });

    if (result && result.success && Array.isArray(result.checklists)) {
        allChecklists[key] = result.checklists;
    } else {
        allChecklists[key] = before;
        showNotification("Not deleted", result?.message || "Couldn't delete the checklist item.");
    }

    onChecklistChanged();

}

/* Draws a checklist and wires its events once. The element remembers
   WHICH task it is showing (fixes a bug where adding an item in the
   drawer could land on the first task you ever opened). */
function renderChecklistInto(taskId, listElement, formElement, inputElement, options = {}) {

    if (!listElement) return;

    const key = String(taskId);
    const items = getChecklist(key);

    listElement.dataset.taskId = key;
    listElement.dataset.canDelete = options.canDelete ? "1" : "";

    listElement.innerHTML = items.length
        ? items.map(function (item) {
            const done = String(item.status).toLowerCase() === "completed";
            return `
                <div class="checklist-item${done ? " is-done" : ""}${item.pending ? " is-pending" : ""}" data-item-id="${escapeHtml(item.checklistId)}">
                    <input type="checkbox" class="checklist-item-checkbox" ${done ? "checked" : ""} ${item.pending ? "disabled" : ""} aria-label="Mark done">
                    <span class="checklist-item-text">${escapeHtml(item.item)}</span>
                    ${options.canDelete && !item.pending ? `<button type="button" class="checklist-item-remove" aria-label="Delete item">×</button>` : ""}
                </div>
            `;
        }).join("")
        : `<div class="checklist-empty">No checklist items yet.</div>`;

    if (!listElement.dataset.wired) {

        listElement.dataset.wired = "1";

        listElement.addEventListener("change", function (event) {
            if (!event.target.classList.contains("checklist-item-checkbox")) return;
            const itemId = event.target.closest(".checklist-item")?.dataset.itemId;
            if (itemId) toggleChecklistItem(listElement.dataset.taskId, itemId);
        });

        listElement.addEventListener("click", function (event) {
            const remove = event.target.closest(".checklist-item-remove");
            if (!remove || !listElement.dataset.canDelete) return;
            const itemId = remove.closest(".checklist-item")?.dataset.itemId;
            if (itemId && confirm("Delete this checklist item?")) removeChecklistItem(listElement.dataset.taskId, itemId);
        });

    }

    if (formElement) {

        formElement.dataset.taskId = key;
        formElement.style.display = options.canAdd === false ? "none" : "flex";

        if (!formElement.dataset.wired) {
            formElement.dataset.wired = "1";
            formElement.addEventListener("submit", function (event) {
                event.preventDefault();
                const value = inputElement.value.trim();
                if (!value) return;
                inputElement.value = "";
                addChecklistItem(formElement.dataset.taskId, value);
                inputElement.focus();
            });
        }

    }

    updateChecklistProgressLabel(key, options.progressElement);

}

/* =========================================================
   COMMENTS (instant, saved in background)
========================================================= */

function getComments(taskId) {
    return allComments[String(taskId)] || [];
}

async function addComment(taskId, text, rerender) {

    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    const key = String(taskId);
    const temp = { commentId: tempId("com"), taskId: key, comment: trimmed, user: currentUserLabel(), date: "", time: "Sending…", pending: true };

    allComments[key] = getComments(key).concat([temp]);
    rerender();

    const result = await apiRequest("addTaskComment", { taskId: key, comment: trimmed });

    if (result && result.success && Array.isArray(result.comments)) {
        allComments[key] = result.comments;
    } else {
        allComments[key] = getComments(key).filter(function (c) { return c.commentId !== temp.commentId; });
        showNotification("Not posted", result?.message || "Couldn't post the comment.");
        return trimmed; // give the text back so it isn't lost
    }

    persistLocalCacheSoon();
    rerender();

}

function renderCommentsInto(taskId, threadElement) {

    if (!threadElement) return;

    const comments = getComments(taskId);

    if (!comments.length) {
        threadElement.innerHTML = `<div class="comment-empty">No comments yet — add the first one.</div>`;
        return;
    }

    threadElement.innerHTML = comments.map(function (c) {
        const when = c.pending ? "Sending…" : [displayDateSafe(c.date), c.time].filter(Boolean).join(" · ");
        return `
            <div class="comment-bubble${c.pending ? " is-pending" : ""}">
                <div class="comment-bubble-head">
                    <span class="comment-bubble-author">${escapeHtml(c.user)}</span>
                    <span class="comment-bubble-date">${escapeHtml(when)}</span>
                </div>
                <div class="comment-bubble-text">${escapeHtml(c.comment)}</div>
            </div>
        `;
    }).join("");

    threadElement.scrollTop = threadElement.scrollHeight;

}

function displayDateSafe(value) {
    return value ? displayDate(value) : "";
}

function wireCommentForm(formId, inputId, getTaskId, rerender) {

    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    if (!form || !input) return;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const taskId = getTaskId();
        const value = input.value.trim();
        if (!taskId || !value) return;
        input.value = "";
        const unsent = await addComment(taskId, value, rerender);
        if (unsent && !input.value) input.value = unsent;
    });

    input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) form.requestSubmit();
    });

}

/* =========================================================
   TASK DETAIL DRAWER
========================================================= */

function renderTaskDetailChecklist() {
    if (!taskDetailCurrentId) return;
    renderChecklistInto(taskDetailCurrentId,
        document.getElementById("taskDetailChecklistList"),
        document.getElementById("taskDetailChecklistForm"),
        document.getElementById("taskDetailChecklistInput"),
        { canAdd: true, canDelete: isPrivilegedUser(), progressElement: document.getElementById("taskDetailChecklistProgress") });
}

function initializeTaskDetailDrawer() {

    wireCommentForm("taskDetailCommentForm", "taskDetailCommentInput",
        function () { return taskDetailCurrentId; },
        function () { renderCommentsInto(taskDetailCurrentId, document.getElementById("taskDetailComments")); });

    // Status: anyone who can see the task. Updates instantly, reverts on failure.
    const statusSelect = document.getElementById("taskDetailStatus");

    statusSelect?.addEventListener("change", async function () {

        const task = tasks.find(function (t) { return t.taskId === taskDetailCurrentId; });
        if (!task) return;

        const previous = task.status;
        const next = statusSelect.value;
        if (previous === next) return;

        task.status = next;
        renderCurrentPage();

        const result = await apiRequest("updateTaskStatus", { taskId: task.taskId, status: next });

        if (result && result.success) {
            upsertLocalTask(result.task);
            showNotification("Updated", `Status set to ${next}.`);
        } else {
            task.status = previous;
            if (taskDetailCurrentId === task.taskId) statusSelect.value = previous;
            renderCurrentPage();
            showNotification("Not saved", result?.message || "Couldn't update the status.");
        }

    });

    // Owners / priority / dates: Founder & Operations Head only.
    const saveMetaButton = document.getElementById("taskDetailSaveMetaButton");

    saveMetaButton?.addEventListener("click", async function () {

        if (!taskDetailCurrentId) return;

        const assignedTo = taskDetailOwnerPicker ? taskDetailOwnerPicker.getValue() : "";
        if (!assignedTo) return showNotification("Missing owner", "Choose at least one owner.");

        setButtonLoading(saveMetaButton, true);

        const result = await apiRequest("updateTask", {
            task: {
                taskId: taskDetailCurrentId,
                assignedTo: assignedTo,
                priority: getInput("taskDetailPriority"),
                dueDate: getInput("taskDetailDueDate"),
                followupDate: getInput("taskDetailFollowupDate")
            }
        });

        setButtonLoading(saveMetaButton, false);

        if (result && result.success) {
            showNotification("Saved", "Task details updated.");
            upsertLocalTask(result.task);
        } else {
            showNotification("Not saved", result?.message || "Couldn't save the changes.");
        }

    });

    const descriptionField = document.getElementById("taskDetailDescription");

    descriptionField?.addEventListener("blur", async function () {

        if (!taskDetailCurrentId || !isPrivilegedUser()) return;

        const task = tasks.find(function (t) { return t.taskId === taskDetailCurrentId; });
        if (!task || task.description === descriptionField.value) return;

        const previous = task.description;
        task.description = descriptionField.value;

        const result = await apiRequest("updateTask", { task: { taskId: task.taskId, description: descriptionField.value } });

        if (result && result.success) upsertLocalTask(result.task);
        else {
            task.description = previous;
            showNotification("Not saved", result?.message || "Couldn't save the description.");
        }

    });

}

function openTaskDetailDrawer(taskId) {

    const task = tasks.find(function (t) { return t.taskId === taskId; });
    if (!task) return showNotification("Error", "Task not found.");

    taskDetailCurrentId = taskId;
    fillTaskDetailDrawer(task);

    document.getElementById("taskDetailDrawer").style.display = "block";
    document.body.classList.add("modal-open");

}

function fillTaskDetailDrawer(task) {

    const privileged = isPrivilegedUser();

    setText("taskDetailName", task.task);
    setInput("taskDetailDescription", task.description);
    setInput("taskDetailId", task.taskId);
    setInput("taskDetailDepartment", task.department);
    setInput("taskDetailPriority", task.priority);
    setInput("taskDetailStatus", task.status);
    setInput("taskDetailCreatedDate", task.createdDate);
    setInput("taskDetailDueDate", task.dueDate);
    setInput("taskDetailFollowupDate", task.followupDate);

    if (taskDetailOwnerPicker) {
        taskDetailOwnerPicker.setValue(task.assignedTo);
        taskDetailOwnerPicker.setDisabled(!privileged);
    }

    ["taskDetailPriority", "taskDetailDueDate", "taskDetailFollowupDate", "taskDetailDescription"].forEach(function (id) {
        const element = document.getElementById(id);
        if (element) element.disabled = !privileged;
    });

    const saveMetaButton = document.getElementById("taskDetailSaveMetaButton");
    const lockedNote = document.getElementById("taskDetailLockedNote");
    if (saveMetaButton) saveMetaButton.style.display = privileged ? "block" : "none";
    if (lockedNote) lockedNote.style.display = privileged ? "none" : "block";

    renderTaskDetailChecklist();
    renderCommentsInto(task.taskId, document.getElementById("taskDetailComments"));

}

function closeTaskDetailDrawer() {

    const drawer = document.getElementById("taskDetailDrawer");
    if (drawer) drawer.style.display = "none";

    document.body.classList.remove("modal-open");
    taskDetailOwnerPicker?.close();
    taskDetailCurrentId = "";

    renderCurrentPage();

}

/* After a background refresh, update any drawer that's open
   (without touching fields the person may be editing). */
function refreshOpenDrawers() {

    if (taskDetailCurrentId) {
        renderTaskDetailChecklist();
        renderCommentsInto(taskDetailCurrentId, document.getElementById("taskDetailComments"));
    }

    if (regularTaskChecklistCurrentId) refreshRegularTaskChecklistDrawer();

    if (backlogDetailCurrentId) {
        renderCommentsInto(backlogDetailCurrentId, document.getElementById("backlogDetailComments"));
    }

}

/* =========================================================
   BACKLOG
========================================================= */

function initializeBacklog() {

    document.getElementById("backlogAddButton")?.addEventListener("click", function () { openBacklogItemModal(); });
    document.getElementById("backlogDepartmentFilter")?.addEventListener("change", renderBacklog);
    document.getElementById("closeBacklogModal")?.addEventListener("click", closeBacklogItemModal);
    document.getElementById("cancelBacklogButton")?.addEventListener("click", closeBacklogItemModal);

    const modal = document.getElementById("backlogItemModal");
    modal?.addEventListener("click", function (event) { if (event.target === modal) closeBacklogItemModal(); });

    document.getElementById("backlogItemForm")?.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (isRequestActive("saveBacklog")) return;
        const button = document.getElementById("saveBacklogItemButton");
        setButtonLoading(button, true);
        try {
            await guardAsync("saveBacklog", saveBacklogItemFromForm);
        } finally {
            setButtonLoading(button, false);
        }
    });

    wireCommentForm("backlogDetailCommentForm", "backlogDetailCommentInput",
        function () { return backlogDetailCurrentId; },
        function () {
            renderCommentsInto(backlogDetailCurrentId, document.getElementById("backlogDetailComments"));
            if (currentPage === "backlog") renderBacklog();
        });

    const grid = document.getElementById("backlogGrid");
    grid?.addEventListener("click", function (event) {
        const edit = event.target.closest(".backlog-edit-button");
        if (edit) {
            event.stopPropagation();
            const item = backlogTasks.find(function (i) { return i.backlogId === edit.dataset.id; });
            if (item) openBacklogItemModal(item);
            return;
        }
        const card = event.target.closest(".backlog-card");
        if (card) openBacklogDetailDrawer(card.dataset.id);
    });

}

function openBacklogItemModal(item = null) {

    const modal = document.getElementById("backlogItemModal");
    if (!modal) return;

    setText("backlogModalTitle", item ? "Edit Backlog Item" : "Add Backlog Item");
    setInput("editBacklogId", item ? item.backlogId : "");
    setInput("backlogTitle", item ? item.task : "");
    setInput("backlogDepartment", item ? item.department : "");
    setInput("backlogStatus", item ? (String(item.status).toLowerCase() === "paused" ? "Paused" : "Backlog") : "Backlog");
    setInput("backlogDescription", item ? item.description : "");
    setInput("backlogExpectedDate", item ? item.expectedDate : "");

    modal.style.display = "flex";
    document.body.classList.add("modal-open");

}

function closeBacklogItemModal() {
    const modal = document.getElementById("backlogItemModal");
    if (modal && modal.style.display !== "none") {
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
    }
}

async function saveBacklogItemFromForm() {

    const editId = getInput("editBacklogId");
    const title = getInput("backlogTitle").trim();

    if (!title) return showNotification("Missing information", "Enter a title.");

    const payload = {
        task: title,
        department: getInput("backlogDepartment"),
        status: getInput("backlogStatus") || "Backlog",
        description: getInput("backlogDescription"),
        expectedDate: getInput("backlogExpectedDate")
    };

    const result = editId
        ? await apiRequest("updateBacklogTask", Object.assign({ backlogId: editId }, payload))
        : await apiRequest("createBacklogTask", payload);

    if (!result || !result.success) {
        return showNotification("Not saved", result?.message || "Couldn't save the backlog item.");
    }

    if (result.item) {
        const index = backlogTasks.findIndex(function (b) { return b.backlogId === result.item.backlogId; });
        if (index !== -1) backlogTasks[index] = result.item;
        else backlogTasks.push(result.item);
        persistLocalCacheSoon();
    }

    closeBacklogItemModal();
    showNotification("Saved", "Backlog item saved.");
    renderBacklog();

}

function renderBacklog() {

    const grid = document.getElementById("backlogGrid");
    if (!grid) return;

    grid.classList.remove("skeleton-card-grid");

    const filter = getInput("backlogDepartmentFilter");
    const scoped = (filter ? backlogTasks.filter(function (i) { return i.department === filter; }) : backlogTasks)
        .filter(function (i) { return String(i.status || "").toLowerCase() !== "moved to active"; });

    const ordered = scoped.slice().sort(makeDateThenPriorityComparator("expectedDate"));

    if (!ordered.length) {
        grid.innerHTML = !dataEverLoaded
            ? skeletonCards(3)
            : filter
                ? `<div class="empty-state">No backlog items for ${escapeHtml(filter)} yet.</div>`
                : `<div class="empty-state">No backlog items yet. Add future or paused work to keep track of it here.</div>`;
        return;
    }

    grid.innerHTML = ordered.map(function (item) {

        const commentCount = getComments(item.backlogId).length;
        const statusClass = String(item.status || "").toLowerCase() === "paused" ? "status-paused" : "status-backlog";
        const dueSoon = isDueSoon(item, "expectedDate");
        const expectedDate = String(item.expectedDate || "").trim();

        return `
            <div class="backlog-card${dueSoon ? " card-due-soon" : ""}" data-id="${escapeHtml(item.backlogId)}">
                <div class="backlog-card-top">
                    <span class="backlog-status-chip ${statusClass}">${escapeHtml(item.status || "Backlog")}</span>
                    ${isPrivilegedUser() ? `<button type="button" class="table-action backlog-edit-button" data-id="${escapeHtml(item.backlogId)}">Edit</button>` : ""}
                </div>
                <h3>${escapeHtml(item.task)}</h3>
                <p class="backlog-card-description">${escapeHtml(item.description || "No description yet.")}</p>
                ${expectedDate ? `<div class="backlog-card-expected">Expected: ${displayDate(expectedDate)}${dueSoon ? ` <span class="due-soon-chip">Due Soon</span>` : ""}</div>` : ""}
                <div class="backlog-card-footer">
                    <span>${escapeHtml(item.department || "Unassigned")} · ${displayDate(item.createdDate)}</span>
                    <span class="backlog-card-comment-count">💬 ${commentCount}</span>
                </div>
            </div>
        `;

    }).join("");

}

function openBacklogDetailDrawer(id) {

    const item = backlogTasks.find(function (i) { return i.backlogId === id; });
    if (!item) return;

    backlogDetailCurrentId = id;

    setText("backlogDetailStatusLabel", String(item.status || "Backlog").toUpperCase());
    setText("backlogDetailTitle", item.task);
    setText("backlogDetailCreatedDate", displayDate(item.createdDate));
    setText("backlogDetailDepartment", item.department ? "· " + item.department : "");
    setText("backlogDetailDescription", item.description || "No description yet.");
    setText("backlogDetailExpected", item.expectedDate ? "· Expected " + displayDate(item.expectedDate) : "");

    renderCommentsInto(id, document.getElementById("backlogDetailComments"));

    document.getElementById("backlogDetailDrawer").style.display = "block";
    document.body.classList.add("modal-open");

}

function closeBacklogDetailDrawer() {
    const drawer = document.getElementById("backlogDetailDrawer");
    if (drawer && drawer.style.display !== "none") {
        drawer.style.display = "none";
        document.body.classList.remove("modal-open");
    }
    backlogDetailCurrentId = "";
}

/* =========================================================
   BOOK FAIR
========================================================= */

function initializeBookFair() {

    document.getElementById("bookFairAddButton")?.addEventListener("click", function () {
        openTaskModal();
        setInput("taskDepartment", "Book Fair - Events");
    });

    const grid = document.getElementById("bookFairGrid");
    grid?.addEventListener("click", function (event) {

        const toggle = event.target.closest(".section-toggle");
        if (toggle) {
            toggleSection(toggle.dataset.pageKey, toggle.dataset.sectionKey);
            return;
        }

        const clickable = event.target.closest(".bookfair-card-top, .bookfair-card-meta");
        if (clickable) openTaskDetailDrawer(clickable.closest(".bookfair-card").dataset.id);

    });

}

function renderBookFair() {

    const grid = document.getElementById("bookFairGrid");
    if (!grid) return;

    grid.classList.remove("skeleton-card-grid");

    const bookFairTasks = tasks.filter(function (t) { return t.department === "Book Fair - Events"; });

    if (!bookFairTasks.length) {
        grid.innerHTML = dataEverLoaded
            ? `<div class="empty-state">No Book Fair tasks you can see yet.</div>`
            : skeletonCards(2);
        return;
    }

    const sections = buildSections(bookFairTasks, { dateField: "dueDate", mineEmptyText: "No Book Fair tasks are assigned to you." });

    grid.innerHTML = sections.map(function (section) {

        const expanded = isSectionExpanded("bookFair", section);
        const header = `
            <div class="grid-section-header${section.collapsible ? " grid-section-header-collapsible" : ""}">
                <span>${escapeHtml(section.title)}</span>
                <span class="table-section-count">${section.items.length}</span>
                ${section.collapsible ? sectionToggleButton("bookFair", section, expanded) : ""}
            </div>
        `;

        if (!expanded) return header;
        if (!section.items.length) return header + `<div class="empty-state grid-span-all">${escapeHtml(section.emptyText)}</div>`;

        return header + section.items.map(bookFairCardHtml).join("");

    }).join("");

    refreshBookFairChecklists();

}

function bookFairCardHtml(task) {

    const id = escapeHtml(task.taskId);
    const priorityClass = "priority-border-" + String(task.priority || "").toLowerCase();

    return `
        <div class="bookfair-card ${priorityClass}${isDueSoon(task) ? " card-due-soon" : ""}" data-id="${id}">
            <div class="bookfair-card-top">
                <h3>${escapeHtml(task.task)}</h3>
                ${priorityBadge(task.priority)}
            </div>
            <div class="bookfair-card-meta">
                <span>${statusBadge(task.status, task)}</span>
                <span class="owners-cell">${ownersDisplay(task.assignedTo)}</span>
                <span>Due ${dueDateWithChip(task)}</span>
            </div>
            <div class="bookfair-checklist-mini">
                <div class="detail-drawer-section-header">
                    <h3>Checklist</h3>
                    <span class="checklist-progress" data-bf-progress="${id}"></span>
                </div>
                <div class="checklist-list" data-bf-list="${id}"></div>
                <form class="checklist-add-form" data-bf-form="${id}">
                    <input type="text" placeholder="Add checklist item..." aria-label="New checklist item">
                    <button type="submit">+ Add</button>
                </form>
            </div>
        </div>
    `;

}

function refreshBookFairChecklists() {

    const grid = document.getElementById("bookFairGrid");
    if (!grid) return;

    grid.querySelectorAll(".bookfair-card").forEach(function (card) {
        const id = card.dataset.id;
        const form = card.querySelector("[data-bf-form]");
        renderChecklistInto(id,
            card.querySelector("[data-bf-list]"),
            form,
            form ? form.querySelector("input") : null,
            { canAdd: true, canDelete: isPrivilegedUser(), progressElement: card.querySelector("[data-bf-progress]") });
    });

}
