// State Management
let appData = { clients: [] };
let chromeProfiles = [];
let currentClientId = null;
let deleteTarget = null; // { type: 'client'|'project', id: string }
let clientViewMode = 'grid';
let isRunningSearchConsoleAll = false;

// UI Elements
const clientGrid = document.getElementById('client-grid');
const projectGrid = document.getElementById('project-grid');
const workspaceView = document.getElementById('workspace-view');
const clientsView = document.getElementById('clients-view');
const sectionView = document.getElementById('section-view');

// Modals
const clientModal = document.getElementById('client-modal');
const projectModal = document.getElementById('project-modal');
const settingsModal = document.getElementById('settings-modal');
const deleteModal = document.getElementById('delete-modal');
const searchConsoleConnectionModal = document.getElementById('search-console-connection-modal');

// Forms
const clientForm = document.getElementById('client-form');
const projectForm = document.getElementById('project-form');

// Initialize
async function init() {
    appData = await window.electronAPI.getData();
    chromeProfiles = await window.electronAPI.getChromeProfiles();
    applyTheme(localStorage.getItem('seo-workspace-theme') || 'light');

    // Migrating old data if structures mismatch
    migrateData();

    setupEventListeners();
    renderClients();
    renderSettings();
}

function migrateData() {
    let changed = false;
    appData.clients.forEach(client => {
        if (!client.chromeProfile) {
            client.chromeProfile = { directory: 'Default', name: 'Default' };
            changed = true;
        }
        if (!client.email) {
            client.email = '';
            changed = true;
        }
        client.projects.forEach(project => {
            if (project.links && !project.resources) {
                // Migrate from older schema with fixed links to resources array
                project.resources = [
                    { name: 'Search Console', url: project.links.gsc || '' },
                    { name: 'GA4', url: project.links.ga4 || '' },
                    { name: 'Sheets', url: project.links.sheets || '' },
                    { name: 'Website', url: project.links.site || '' }
                ];
                delete project.links;
                changed = true;
            }
        });
    });
    if (changed) {
        window.electronAPI.saveData(appData);
    }
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    document.getElementById('theme-light-btn').setAttribute('aria-pressed', String(!isDark));
    document.getElementById('theme-dark-btn').setAttribute('aria-pressed', String(isDark));
    document.querySelectorAll('input[name="theme-choice"]').forEach(input => {
        input.checked = input.value === (isDark ? 'dark' : 'light');
    });
    localStorage.setItem('seo-workspace-theme', isDark ? 'dark' : 'light');
}

function setClientView(mode) {
    clientViewMode = mode;
    document.getElementById('grid-view-btn').setAttribute('aria-pressed', String(mode === 'grid'));
    document.getElementById('list-view-btn').setAttribute('aria-pressed', String(mode === 'list'));
    clientGrid.classList.toggle('client-grid-list', mode === 'list');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function getFaviconUrl(resourceUrl) {
    try {
        const url = new URL(resourceUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return `${url.origin}/favicon.ico`;
    } catch {
        return '';
    }
}

function renderProjectResources(resources) {
    document.getElementById('project-resources-list').innerHTML = resources.map((resource, index) => `
        <div class="resource-form-row subtle-surface p-4 rounded-xl border">
            <div class="flex items-center justify-between gap-2 mb-3">
                <label class="resource-row-label text-xs font-bold uppercase muted-text">Resource ${index + 1}</label>
                <button type="button" class="remove-resource-btn muted-text hover:text-red-500 w-8 h-8 rounded-lg" data-index="${index}" title="Remove resource" aria-label="Remove resource ${index + 1}"><i class="fas fa-trash text-xs"></i></button>
            </div>
            <input type="text" data-resource-name value="${escapeHtml(resource.name || '')}" placeholder="Name" aria-label="Resource ${index + 1} name" class="form-control w-full px-3 py-2 border rounded-md mb-2 text-sm outline-none focus:border-blue-500">
            <input type="url" data-resource-url value="${escapeHtml(resource.url || '')}" placeholder="URL" aria-label="Resource ${index + 1} URL" class="form-control w-full px-3 py-2 border rounded-md text-sm outline-none focus:border-blue-500">
        </div>
    `).join('');
}

function readProjectResources() {
    return Array.from(document.querySelectorAll('#project-resources-list .resource-form-row'), (row, index) => ({
        name: row.querySelector('[data-resource-name]').value || `Resource ${index + 1}`,
        url: row.querySelector('[data-resource-url]').value.trim()
    }));
}

// Rendering
function renderClients() {
    clientGrid.innerHTML = '';
    const query = document.getElementById('search-input').value.toLowerCase();
    const filteredClients = appData.clients.filter(c => c.name.toLowerCase().includes(query));

    if (!filteredClients.length) {
        const emptyTitle = appData.clients.length ? 'No matching clients' : 'No clients yet';
        const emptyDescription = appData.clients.length ? 'Try a different search.' : 'Add your first client to start organizing projects.';
        clientGrid.innerHTML = `<div class="empty-state surface-card rounded-2xl flex flex-col items-center justify-center text-center p-8"><div class="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style="background: var(--surface-raised); color: var(--text-secondary);"><i class="fas fa-users text-xl"></i></div><h3 class="theme-text font-bold text-lg">${emptyTitle}</h3><p class="muted-text text-sm mt-1 mb-5">${emptyDescription}</p>${appData.clients.length ? '' : '<button type="button" class="empty-create-client bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-semibold"><i class="fas fa-plus mr-2"></i>Add Client</button>'}</div>`;
        return;
    }

    filteredClients.forEach(client => {
        const card = document.createElement('div');
        card.className = 'client-card bg-glass p-3 border transition-all group hover-glow';
        card.innerHTML = `
            <div class="client-card-content">
                <div class="client-card-details min-w-0">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="theme-text text-base font-bold leading-tight truncate">${client.name}</h3>
                    </div>
                    <p class="muted-text text-sm mt-1">${client.projects.length} ${client.projects.length === 1 ? 'project' : 'projects'}</p>
                    ${client.email ? `<p class="muted-text text-xs mt-1 truncate">${client.email}</p>` : ''}
                    <div class="flex items-center gap-2 mt-2">
                        <i class="fab fa-chrome text-blue-600" aria-hidden="true"></i>
                        <span class="text-xs px-2 py-1 rounded-lg truncate max-w-[160px]" style="color: var(--text-secondary); background: var(--surface-muted);">${client.chromeProfile?.name || 'Default'}</span>
                    </div>
                </div>
                <div class="client-card-actions flex gap-1 self-start">
                    <button type="button" class="edit-client icon-button !w-8 !h-8 !border-0 !bg-transparent" data-id="${client.id}" title="Edit client" aria-label="Edit ${client.name}"><i class="fas fa-pen text-xs"></i></button>
                    <button type="button" class="delete-client icon-button !w-8 !h-8 !border-0 !bg-transparent hover:!text-red-500" data-id="${client.id}" title="Delete client" aria-label="Delete ${client.name}"><i class="fas fa-trash text-xs"></i></button>
                </div>
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button')) openClientWorkspace(client.id);
        });
        clientGrid.appendChild(card);
    });
    clientGrid.classList.toggle('client-grid-list', clientViewMode === 'list');
}

function renderProjects() {
    projectGrid.innerHTML = '';
    const client = appData.clients.find(c => c.id === currentClientId);
    if (!client) return;

    document.getElementById('current-client-name').textContent = client.name;
    document.getElementById('current-client-info').textContent = `${client.projects.length} ${client.projects.length === 1 ? 'project' : 'projects'} · ${client.chromeProfile?.name || 'Default'}`;
    const analyticsButton = document.getElementById('open-client-analytics-btn');
    const clientAnalytics = client.projects.flatMap(project => project.resources || [])
        .find(resource => /^(analytics|ga4)$/i.test(resource.name || '') && resource.url);
    analyticsButton.classList.toggle('hidden', !clientAnalytics);

    const query = document.getElementById('project-search-input').value.toLowerCase();
    const filteredProjects = client.projects.filter(p => p.name.toLowerCase().includes(query));

    if (!filteredProjects.length) {
        const emptyTitle = client.projects.length ? 'No matching projects' : 'No projects yet';
        const emptyDescription = client.projects.length ? 'Try a different search.' : 'Add a project to create quick access to its resources.';
        projectGrid.innerHTML = `<div class="empty-state surface-card rounded-2xl flex flex-col items-center justify-center text-center p-8"><div class="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style="background: var(--surface-raised); color: var(--text-secondary);"><i class="fas fa-cube text-xl"></i></div><h3 class="theme-text font-bold text-lg">${emptyTitle}</h3><p class="muted-text text-sm mt-1 mb-5">${emptyDescription}</p>${client.projects.length ? '' : '<button type="button" class="empty-create-project bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-semibold"><i class="fas fa-plus mr-2"></i>Add Project</button>'}</div>`;
        return;
    }

    filteredProjects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card bg-glass border flex flex-col hover-glow';

        const visibleResources = project.resources.filter(res => !/^(analytics|ga4)$/i.test(res.name || ''));
        let resourceGrid = '';
        visibleResources.forEach((res, index) => {
            const faviconUrl = getFaviconUrl(res.url);
            resourceGrid += `
                <button type="button" class="link-btn resource-tile resource-${(index % 4) + 1} p-3 text-left flex flex-col items-center justify-center gap-2" data-url="${escapeHtml(res.url || '')}" title="Open ${escapeHtml(res.name || 'resource')}">
                    ${faviconUrl ? `<img class="resource-favicon" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
                    <span class="resource-icon-fallback" ${faviconUrl ? 'hidden' : ''}><i class="fas fa-link text-lg" aria-hidden="true"></i></span>
                    <span class="text-[11px] font-semibold truncate w-full text-center">${escapeHtml(res.name || 'Resource')}</span>
                </button>
            `;
        });

        card.innerHTML = `
            <div class="flex justify-between items-start mb-6">
                <div>
                    <h3 class="theme-text text-base font-bold truncate">${project.name}</h3>
                    <p class="muted-text text-xs mt-1">${visibleResources.length} quick actions</p>
                </div>
                <div class="flex space-x-1">
                    <button type="button" class="edit-project icon-button !w-8 !h-8 !border-0 !bg-transparent" data-id="${project.id}" title="Edit project" aria-label="Edit ${project.name}"><i class="fas fa-pen text-xs"></i></button>
                    <button type="button" class="delete-project icon-button !w-8 !h-8 !border-0 !bg-transparent hover:!text-red-500" data-id="${project.id}" title="Delete project" aria-label="Delete ${project.name}"><i class="fas fa-trash text-xs"></i></button>
                </div>
            </div>
            <div class="resource-grid grid gap-2 mb-4">
                ${resourceGrid}
            </div>
            <button type="button" class="open-all-btn subtle-surface w-full py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <i class="fas fa-arrow-up-right-from-square text-xs"></i> <span>Open all resources</span>
            </button>
        `;
        // Launch individual resource URL
        card.querySelectorAll('.link-btn').forEach(btn => {
            btn.addEventListener('click', () => launchUrl(btn.dataset.url));
        });
        card.querySelectorAll('.resource-favicon').forEach(image => {
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.hidden = false;
            }, { once: true });
        });

        // Launch all project resources
        card.querySelector('.open-all-btn').addEventListener('click', () => {
            visibleResources.forEach(res => {
                if (res.url) launchUrl(res.url);
            });
        });

        // Edit/Delete handlers
        // (Delegation added in setupEventListeners)

        projectGrid.appendChild(card);
    });
}

function renderSettings() {
    const list = document.getElementById('profiles-list');
    list.innerHTML = chromeProfiles.map(p => `
        <div class="profile-row flex items-center justify-between p-4 border rounded-xl">
            <div>
                <div class="font-bold theme-text">${p.name}</div>
                <div class="text-xs muted-text">${p.directory}</div>
            </div>
            <button type="button" class="test-profile icon-button !w-auto !h-9 px-3 text-sm" data-dir="${p.directory}">Test</button>
        </div>
    `).join('');

    // Attach Test actions
    list.querySelectorAll('.test-profile').forEach(btn => {
        btn.addEventListener('click', async () => {
            const dir = btn.dataset.dir;
            await window.electronAPI.launchUrlWithProfile({ url: 'https://example.com', profileDir: dir });
        });
    });
}

// Launch URLs
async function launchUrl(url) {
    if (!url) return;
    const client = appData.clients.find(c => c.id === currentClientId);
    const profileDir = client?.chromeProfile?.directory || 'Default';

    const result = await window.electronAPI.launchUrlWithProfile({ url, profileDir });
    if (!result.success) {
        alert(`Error: ${result.error}`);
    }
}

// Modal Form Operations
function openClientModal(id = null) {
    const profileInput = document.getElementById('client-profile-input');
    profileInput.innerHTML = chromeProfiles.map(p => `<option value="${p.directory}" data-name="${p.name}">${p.name}</option>`).join('');

    if (id) {
        const client = appData.clients.find(c => c.id === id);
        document.getElementById('client-modal-title').textContent = 'Edit Client';
        document.getElementById('client-id-input').value = client.id;
        document.getElementById('client-name-input').value = client.name;
        document.getElementById('client-email-input').value = client.email || '';
        profileInput.value = client.chromeProfile?.directory || 'Default';
    } else {
        document.getElementById('client-modal-title').textContent = 'Add New Client';
        clientForm.reset();
        document.getElementById('client-id-input').value = '';
    }
    clientModal.classList.add('active');
}

function openProjectModal(id = null) {
    let resources;
    if (id) {
        const client = appData.clients.find(c => c.id === currentClientId);
        const project = client.projects.find(p => p.id === id);
        document.getElementById('project-modal-title').textContent = 'Edit Project';
        document.getElementById('project-id-input').value = project.id;
        document.getElementById('project-name-input').value = project.name;
        resources = project.resources || [];
    } else {
        document.getElementById('project-modal-title').textContent = 'Add New Project';
        projectForm.reset();
        document.getElementById('project-id-input').value = '';
        resources = [
            { name: 'Search Console', url: '' },
            { name: 'GA4', url: '' },
            { name: 'Sheets', url: '' },
            { name: 'Website', url: '' }
        ];
    }
    renderProjectResources(resources);
    projectModal.classList.add('active');
}

function openSearchConsoleConnectionModal(clientId, projectId) {
    const client = appData.clients.find(item => item.id === clientId);
    const project = client?.projects.find(item => item.id === projectId);
    if (!client || !project) return;

    const workflow = window.reportingWorkflows.searchConsole;
    const settings = workflow.getSettings(project);
    document.getElementById('search-console-connection-client-id').value = client.id;
    document.getElementById('search-console-connection-project-id').value = project.id;
    document.getElementById('search-console-connection-project').textContent = `${client.name} · ${project.name}`;
    document.getElementById('search-console-spreadsheet-id').value = workflow.getSpreadsheetId(project);
    document.getElementById('search-console-script-url').value = settings.scriptUrl;
    searchConsoleConnectionModal.classList.add('active');
}

function showDeleteConfirm(type, id) {
    deleteTarget = {
        type,
        id,
        clientId: type === 'project' ? currentClientId : null
    };
    deleteModal.classList.add('active');
}

function closeAllModals() {
    clientModal.classList.remove('active');
    projectModal.classList.remove('active');
    settingsModal.classList.remove('active');
    deleteModal.classList.remove('active');
    searchConsoleConnectionModal.classList.remove('active');
    deleteTarget = null;
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('logo-home').addEventListener('click', showClientsView);
    document.getElementById('back-to-clients').addEventListener('click', showClientsView);
    document.getElementById('section-back-to-clients').addEventListener('click', showClientsView);
    document.getElementById('search-console-btn').addEventListener('click', () => showSectionView('searchConsole'));
    document.getElementById('analytics-btn').addEventListener('click', () => showSectionView('analytics'));
    sectionView.addEventListener('change', (event) => {
        if (event.target.matches('[data-reporting-field]')) saveReportingSetting(event.target);
    });
    sectionView.addEventListener('input', (event) => {
        if (event.target.matches('[data-reporting-field]')) event.target.setCustomValidity('');
        if (event.target.matches('[data-search-console-master-field]')) event.target.setCustomValidity('');
    });
    sectionView.addEventListener('click', (event) => {

        const analyticsButton = event.target.closest('.analytics-open-sheet');
        if (analyticsButton) {
            openAnalyticsSpreadsheet(analyticsButton);
            return;
        }
        const sheetButton = event.target.closest('.reporting-open-sheet');
        if (sheetButton) {
            openReportingSpreadsheet(sheetButton);
            return;
        }
        const editConnectionButton = event.target.closest('.reporting-edit-connection');
        if (editConnectionButton) {
            openSearchConsoleConnectionModal(editConnectionButton.dataset.clientId, editConnectionButton.dataset.projectId);
            return;
        }
        const runButton = event.target.closest('.reporting-run');
        if (runButton) runReportingWorkflow(runButton);
    });
    document.getElementById('search-console-run-all').addEventListener('click', runAllSearchConsole);
    document.getElementById('search-console-apply-master').addEventListener('click', applySearchConsoleMasterSettings);
    document.getElementById('add-client-btn').addEventListener('click', () => openClientModal());
    document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal());
    document.getElementById('open-client-analytics-btn').addEventListener('click', () => {
        const client = appData.clients.find(item => item.id === currentClientId);
        const resource = client?.projects.flatMap(project => project.resources || [])
            .find(item => /^(analytics|ga4)$/i.test(item.name || '') && item.url);
        if (resource) launchUrl(resource.url);
    });
    document.getElementById('add-resource-btn').addEventListener('click', () => {
        const resources = readProjectResources();
        resources.push({ name: '', url: '' });
        renderProjectResources(resources);
    });
    document.getElementById('project-resources-list').addEventListener('click', (e) => {
        const removeButton = e.target.closest('.remove-resource-btn');
        if (!removeButton) return;
        const resources = readProjectResources();
        resources.splice(Number(removeButton.dataset.index), 1);
        renderProjectResources(resources);
    });
    document.getElementById('settings-btn').addEventListener('click', () => settingsModal.classList.add('active'));

    document.getElementById('refresh-profiles-btn').addEventListener('click', async () => {
        chromeProfiles = await window.electronAPI.getChromeProfiles();
        renderSettings();
    });

    // Search Listeners
    document.getElementById('search-input').addEventListener('input', renderClients);
    document.getElementById('project-search-input').addEventListener('input', renderProjects);
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
        if (document.querySelector('.modal.active')) return;

        e.preventDefault();
        const search = document.getElementById(
            workspaceView.classList.contains('hidden') ? 'search-input' : 'project-search-input'
        );
        search.focus();
        search.select();
    });

    // Client Edit/Delete Listeners
    clientGrid.addEventListener('click', (e) => {
        if (e.target.closest('.empty-create-client')) {
            openClientModal();
            return;
        }
        const editBtn = e.target.closest('.edit-client');
        const deleteBtn = e.target.closest('.delete-client');

        if (editBtn) {
            openClientModal(editBtn.dataset.id);
        } else if (deleteBtn) {
            showDeleteConfirm('client', deleteBtn.dataset.id);
        }
    });

    // Project Edit/Delete Listeners
    projectGrid.addEventListener('click', (e) => {
        if (e.target.closest('.empty-create-project')) {
            openProjectModal();
            return;
        }
        const editBtn = e.target.closest('.edit-project');
        const deleteBtn = e.target.closest('.delete-project');

        if (editBtn) {
            openProjectModal(editBtn.dataset.id);
        } else if (deleteBtn) {
            showDeleteConfirm('project', deleteBtn.dataset.id);
        }
    });

    document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light'));
    document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark'));
    document.getElementById('grid-view-btn').addEventListener('click', () => setClientView('grid'));
    document.getElementById('list-view-btn').addEventListener('click', () => setClientView('list'));

    // Appearance setting mirrors the header theme buttons.
    document.querySelectorAll('input[name="theme-choice"]').forEach(radio => {
        radio.addEventListener('change', (e) => applyTheme(e.target.value));
    });

    // Modal Tabs Logic
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('text-blue-400', 'bg-blue-500/10'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

            btn.classList.add('text-blue-400', 'bg-blue-500/10');
            document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
        });
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    document.getElementById('search-console-connection-form').addEventListener('submit', saveSearchConsoleConnection);

    // Forms Submission
    clientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('client-id-input').value;
        const name = document.getElementById('client-name-input').value;
        const email = document.getElementById('client-email-input').value;
        const profileSelect = document.getElementById('client-profile-input');
        const profileDir = profileSelect.value;
        const profileName = profileSelect.options[profileSelect.selectedIndex]?.dataset.name || 'Default';

        const clientData = {
            id: id || Date.now().toString(),
            name,
            email,
            chromeProfile: { directory: profileDir, name: profileName },
            projects: id ? appData.clients.find(c => c.id === id).projects : []
        };

        const previousData = JSON.parse(JSON.stringify(appData));
        if (id) {
            const index = appData.clients.findIndex(c => c.id === id);
            appData.clients[index] = clientData;
        } else {
            appData.clients.push(clientData);
        }

        try {
            const result = await window.electronAPI.saveData(appData);
            if (!result?.success) throw new Error(result?.error || 'Unable to save client.');
        } catch (error) {
            appData = previousData;
            alert(`Error saving client: ${error.message}`);
            return;
        }
        closeAllModals();
        renderClients();
    });

    projectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const client = appData.clients.find(c => c.id === currentClientId);
        if (!client) return;

        const id = document.getElementById('project-id-input').value;
        const name = document.getElementById('project-name-input').value;

        const resources = readProjectResources();

        const existingProject = id ? client.projects.find(project => project.id === id) : null;
        const projectData = {
            ...(existingProject || {}),
            id: id || Date.now().toString(),
            name,
            resources
        };

        const previousData = JSON.parse(JSON.stringify(appData));
        if (id) {
            const index = client.projects.findIndex(p => p.id === id);
            client.projects[index] = projectData;
        } else {
            client.projects.push(projectData);
        }

        try {
            const result = await window.electronAPI.saveData(appData);
            if (!result?.success) throw new Error(result?.error || 'Unable to save project.');
        } catch (error) {
            appData = previousData;
            alert(`Error saving project: ${error.message}`);
            return;
        }
        closeAllModals();
        renderProjects();
    });

    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (!deleteTarget) {
            return;
        }

        const target = deleteTarget;
        const previousData = JSON.parse(JSON.stringify(appData));

        if (target.type === 'client') {
            appData.clients = appData.clients.filter(client => client.id !== target.id);
        } else if (target.type === 'project') {
            const client = appData.clients.find(item => item.id === target.clientId);
            if (!client) return;
            client.projects = client.projects.filter(project => project.id !== target.id);
        } else {
            return;
        }

        try {
            const result = await window.electronAPI.saveData(appData);
            if (!result?.success) throw new Error(result?.error || 'Unable to save deletion.');
        } catch (error) {
            appData = previousData;
            alert(`Error deleting ${target.type}: ${error.message}`);
            return;
        }

        if (target.type === 'client') {
            showClientsView();
        } else {
            renderProjects();
        }
        closeAllModals();
    });
}

function showClientsView() {
    currentClientId = null;
    document.getElementById('add-client-btn').classList.remove('hidden');
    document.getElementById('add-project-btn').classList.add('hidden');
    workspaceView.classList.add('hidden');
    sectionView.classList.add('hidden');
    clientsView.classList.remove('hidden');
    clientsView.classList.add('animate-in', 'fade-in', 'slide-in-from-left-4', 'duration-200');

    // Show global search
    document.getElementById('search-input').parentElement.classList.remove('hidden');

    renderClients();
}

function getReportingProjects() {
    return appData.clients.flatMap(client => (client.projects || []).map(project => ({ client, project })));
}

function reportingInput(field, value, label, type = 'text') {
    const isDate = type === 'date';
    const displayValue = isDate ? formatReportingDateForInput(value) : value;
    return `<input class="reporting-control" type="${isDate ? 'text' : type}"${isDate ? ' inputmode="text" autocomplete="off"' : ''} data-reporting-field="${field}" value="${escapeHtml(displayValue)}" aria-label="${escapeHtml(label)}" placeholder="${isDate ? 'DD-MM-YYYY' : 'Set value'}">`;
}

function parseReportingDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    let year, month, day;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        [, year, month, day] = match;
    } else {
        // For pasted dates, prefer the user's day-first DD-MM-YYYY format.
        match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (!match) return null;
        [, day, month, year] = match;
    }

    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatReportingDateForInput(value) {
    const normalized = parseReportingDate(value);
    if (!normalized) return value || '';
    const [year, month, day] = normalized.split('-');
    return `${day}-${month}-${year}`;
}

function reportingStatus(type) {
    return document.getElementById('search-console-status');
}

function renderReportingSection(type) {
    document.getElementById('search-console-panel').classList.remove('hidden');

    const masterSettings = appData.reportingDefaults?.searchConsole || {};
    document.getElementById('search-console-master-start-date').value = formatReportingDateForInput(masterSettings.startDate);
    document.getElementById('search-console-master-end-date').value = formatReportingDateForInput(masterSettings.endDate);
    document.getElementById('search-console-master-sheet-name').value = masterSettings.sheetName || '';

    const rows = getReportingProjects();
    const tbody = document.getElementById('search-console-rows');
    const emptyState = document.getElementById('search-console-empty');
    tbody.innerHTML = rows.map(({ client, project }) => {
        const settings = window.reportingWorkflows.searchConsole.getSettings(project);
        const spreadsheetId = window.reportingWorkflows.searchConsole.getSpreadsheetId(project);
        const connectionEditor = `<button type="button" class="reporting-edit-connection mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border-color)] muted-text text-xs font-semibold hover:text-blue-600 hover:border-blue-500 transition-colors" data-client-id="${escapeHtml(client.id)}" data-project-id="${escapeHtml(project.id)}"><i class="fas fa-sliders-h" aria-hidden="true"></i><span>Edit</span></button>`;
        const projectCell = `<button type="button" class="reporting-open-sheet block max-w-44 text-left font-semibold theme-text truncate hover:text-blue-600 hover:underline underline-offset-2 transition-colors" data-client-id="${escapeHtml(client.id)}" data-project-id="${escapeHtml(project.id)}" aria-label="Open ${escapeHtml(project.name)} spreadsheet in its Chrome profile" title="Open connected spreadsheet">${escapeHtml(project.name)}</button>${connectionEditor}`;
        const inputs = [
            reportingInput('propertyUrl', window.reportingWorkflows.searchConsole.getPropertyUrl(project), `${project.name} Property URL`),
            reportingInput('startDate', settings.startDate, `${project.name} Start Date`, 'date'),
            reportingInput('endDate', settings.endDate, `${project.name} End Date`, 'date'),
            reportingInput('dimension', settings.dimension, `${project.name} Dimension`),
            reportingInput('searchType', settings.searchType, `${project.name} Search Type`),
            reportingInput('country', settings.country, `${project.name} Country`),
            reportingInput('outputMode', settings.outputMode, `${project.name} Output Mode`),
            reportingInput('sheetName', settings.sheetName, `${project.name} Sheet Name`)
        ];
        return `<tr data-client-id="${escapeHtml(client.id)}" data-project-id="${escapeHtml(project.id)}"><td>${projectCell}</td>${inputs.map(input => `<td>${input}</td>`).join('')}<td><button type="button" class="reporting-run bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg font-semibold text-xs transition-colors whitespace-nowrap" data-workflow="searchConsole">Run</button></td></tr>`;
    }).join('');
    emptyState.classList.toggle('hidden', rows.length > 0);
    tbody.closest('table').classList.toggle('hidden', rows.length === 0);
}

function renderAnalyticsSection() {
    const tbody = document.getElementById('analytics-rows');
    const emptyState = document.getElementById('analytics-empty');
    const status = document.getElementById('analytics-status');
    status.textContent = '';

    const rows = appData.clients.flatMap(client => {
        for (const project of client.projects || []) {
            const resource = (project.resources || []).find(item => /^(analytics|ga4)$/i.test(item.name || '') && item.url);
            if (resource) return [{ client, project }];
        }
        return [];
    });

    tbody.innerHTML = rows.map(({ client, project }) => `
        <tr>
            <td class="font-semibold theme-text">${escapeHtml(client.name)}</td>
            <td>${escapeHtml(client.chromeProfile?.name || 'Default')}</td>
            <td>${escapeHtml(project.name)}</td>
            <td><span class="muted-text">Google Sheets workbook</span></td>
            <td><button type="button" class="analytics-open-sheet bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg font-semibold text-xs transition-colors whitespace-nowrap" data-client-id="${escapeHtml(client.id)}" data-project-id="${escapeHtml(project.id)}"><i class="fas fa-arrow-up-right-from-square mr-1"></i>Open sheet</button></td>
        </tr>
    `).join('');
    emptyState.classList.toggle('hidden', rows.length > 0);
    tbody.closest('table').classList.toggle('hidden', rows.length === 0);
}
async function applySearchConsoleMasterSettings() {
    const startInput = document.getElementById('search-console-master-start-date');
    const endInput = document.getElementById('search-console-master-end-date');
    const sheetNameInput = document.getElementById('search-console-master-sheet-name');
    const status = reportingStatus('searchConsole');
    const startDate = parseReportingDate(startInput.value);
    const endDate = parseReportingDate(endInput.value);
    const sheetName = sheetNameInput.value.trim();

    startInput.setCustomValidity(startDate ? '' : 'Enter the start date as DD-MM-YYYY or YYYY-MM-DD.');
    endInput.setCustomValidity(endDate ? '' : 'Enter the end date as DD-MM-YYYY or YYYY-MM-DD.');
    sheetNameInput.setCustomValidity(sheetName ? '' : 'Enter a sheet name.');
    if (!startDate) { startInput.reportValidity(); status.textContent = 'Enter a valid master start date.'; return; }
    if (!endDate) { endInput.reportValidity(); status.textContent = 'Enter a valid master end date.'; return; }
    if (startDate > endDate) {
        endInput.setCustomValidity('End date must be on or after the start date.');
        endInput.reportValidity();
        status.textContent = 'End date must be on or after the start date.';
        return;
    }
    if (!sheetName) { sheetNameInput.reportValidity(); status.textContent = 'Enter a master sheet name.'; return; }

    const projects = getReportingProjects();
    if (!projects.length) {
        status.textContent = 'There are no projects to update yet.';
        return;
    }

    const previousData = JSON.parse(JSON.stringify(appData));
    appData.reportingDefaults ||= {};
    appData.reportingDefaults.searchConsole = { startDate, endDate, sheetName };
    projects.forEach(({ project }) => {
        project.reporting ||= {};
        project.reporting.searchConsole ||= {};
        Object.assign(project.reporting.searchConsole, { startDate, endDate, sheetName });
    });

    status.textContent = 'Applying master settings…';
    try {
        const result = await window.electronAPI.saveData(appData);
        if (!result?.success) throw new Error(result?.error || 'Unable to save the master settings.');
        startInput.value = formatReportingDateForInput(startDate);
        endInput.value = formatReportingDateForInput(endDate);
        renderReportingSection('searchConsole');
        status.textContent = `Applied dates and sheet name to all ${projects.length} projects.`;
    } catch (error) {
        appData = previousData;
        status.textContent = 'Master settings could not be saved.';
        alert(`Error applying master settings: ${error.message}`);
    }
}

async function openReportingSpreadsheet(button) {
    const client = appData.clients.find(item => item.id === button.dataset.clientId);
    const project = client?.projects.find(item => item.id === button.dataset.projectId);
    if (!client || !project) return;

    const spreadsheetId = window.reportingWorkflows.searchConsole.getSpreadsheetId(project);
    const status = reportingStatus('searchConsole');
    if (!spreadsheetId) {
        status.textContent = `No spreadsheet is connected for ${project.name}. Use Edit to add its Spreadsheet ID.`;
        return;
    }

    button.disabled = true;
    button.classList.add('opacity-60', 'cursor-wait');
    status.textContent = `Opening ${project.name} spreadsheet in its Chrome profile…`;
    try {
        const result = await window.electronAPI.launchUrlWithProfile({
            url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
            profileDir: client.chromeProfile?.directory || 'Default'
        });
        if (!result?.success) throw new Error(result?.error || 'Unable to open the spreadsheet.');
        status.textContent = `Opened ${project.name} spreadsheet in its Chrome profile.`;
    } catch (error) {
        status.textContent = `Could not open ${project.name}: ${error.message}`;
    } finally {
        button.disabled = false;
        button.classList.remove('opacity-60', 'cursor-wait');
    }
}

async function openAnalyticsSpreadsheet(button) {
    const client = appData.clients.find(item => item.id === button.dataset.clientId);
    const project = client?.projects.find(item => item.id === button.dataset.projectId);
    const resource = project?.resources.find(item => /^(analytics|ga4)$/i.test(item.name || '') && item.url);
    const status = document.getElementById('analytics-status');
    if (!client || !project || !resource) {
        status.textContent = 'This group does not have an Analytics sheet connected.';
        return;
    }

    button.disabled = true;
    button.classList.add('opacity-60', 'cursor-wait');
    status.textContent = `Opening ${client.name} Analytics in the ${client.chromeProfile?.name || 'Default'} Chrome profile…`;
    try {
        const result = await window.electronAPI.launchUrlWithProfile({
            url: resource.url,
            profileDir: client.chromeProfile?.directory || 'Default'
        });
        if (!result?.success) throw new Error(result?.error || 'Unable to open the Analytics sheet.');
        status.textContent = `Opened ${client.name} Analytics in its Chrome profile.`;
    } catch (error) {
        status.textContent = `Could not open ${client.name} Analytics: ${error.message}`;
    } finally {
        button.disabled = false;
        button.classList.remove('opacity-60', 'cursor-wait');
    }
}
async function saveReportingSetting(input) {
    const row = input.closest('tr');
    const type = input.closest('table').dataset.reportingType;
    const client = appData.clients.find(item => item.id === row.dataset.clientId);
    const project = client?.projects.find(item => item.id === row.dataset.projectId);
    if (!project) return;

    let value = input.value.trim();
    if (input.dataset.reportingField === 'startDate' || input.dataset.reportingField === 'endDate') {
        const normalizedDate = parseReportingDate(value);
        if (normalizedDate === null) {
            input.setCustomValidity('Enter a date as DD-MM-YYYY or YYYY-MM-DD.');
            input.reportValidity();
            reportingStatus(type).textContent = 'Date not saved. Use DD-MM-YYYY or YYYY-MM-DD.';
            return;
        }
        input.setCustomValidity('');
        value = normalizedDate;
        input.value = formatReportingDateForInput(value);
    }

    const previousData = JSON.parse(JSON.stringify(appData));
    project.reporting ||= {};
    project.reporting[type] ||= {};
    project.reporting[type][input.dataset.reportingField] = value;
    const status = reportingStatus(type);
    status.textContent = 'Saving…';
    try {
        const result = await window.electronAPI.saveData(appData);
        if (!result?.success) throw new Error(result?.error || 'Unable to save reporting settings.');
        status.textContent = 'Settings saved';
    } catch (error) {
        appData = previousData;
        status.textContent = 'Save failed';
        alert(`Error saving reporting settings: ${error.message}`);
    }
}

async function saveSearchConsoleConnection(event) {
    event.preventDefault();
    const clientId = document.getElementById('search-console-connection-client-id').value;
    const projectId = document.getElementById('search-console-connection-project-id').value;
    const client = appData.clients.find(item => item.id === clientId);
    const project = client?.projects.find(item => item.id === projectId);
    if (!client || !project) return;

    const previousData = JSON.parse(JSON.stringify(appData));
    project.reporting ||= {};
    project.reporting.searchConsole ||= {};
    project.reporting.searchConsole.spreadsheetId = document.getElementById('search-console-spreadsheet-id').value.trim();
    project.reporting.searchConsole.scriptUrl = document.getElementById('search-console-script-url').value.trim();
    const status = reportingStatus('searchConsole');
    status.textContent = 'Saving connection…';
    try {
        const result = await window.electronAPI.saveData(appData);
        if (!result?.success) throw new Error(result?.error || 'Unable to save the Search Console connection.');
        closeAllModals();
        status.textContent = `Connection saved for ${project.name}.`;
    } catch (error) {
        appData = previousData;
        status.textContent = 'Connection save failed';
        alert(`Error saving Search Console connection: ${error.message}`);
    }
}

async function runAllSearchConsole() {
    if (isRunningSearchConsoleAll) return;
    const rows = [...document.querySelectorAll('#search-console-rows tr[data-project-id]')];
    const status = reportingStatus('searchConsole');
    const runAllButton = document.getElementById('search-console-run-all');
    if (!rows.length) {
        status.textContent = 'There are no projects to run.';
        return;
    }

    isRunningSearchConsoleAll = true;
    runAllButton.disabled = true;
    runAllButton.classList.add('opacity-60', 'cursor-not-allowed');
    const runButtons = [...document.querySelectorAll('.reporting-run[data-workflow="searchConsole"]')];
    runButtons.forEach(runButton => {
        runButton.disabled = true;
        runButton.classList.add('opacity-60', 'cursor-not-allowed');
    });

    let started = 0;
    const failures = [];
    try {
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const project = appData.clients
                .find(client => client.id === row.dataset.clientId)
                ?.projects.find(item => item.id === row.dataset.projectId);
            status.textContent = `Starting ${index + 1} of ${rows.length}${project ? ` · ${project.name}` : ''}…`;
            const button = row.querySelector('.reporting-run');
            const result = await runReportingWorkflow(button, { fromRunAll: true });
            if (result.success) started++;
            else failures.push(`${project?.name || 'Unknown project'}: ${result.message}`);
        }
        status.textContent = failures.length
            ? `Started ${started} of ${rows.length}. Could not start: ${failures.join('; ')}`
            : `Started Search Console for all ${started} projects.`;
    } finally {
        isRunningSearchConsoleAll = false;
        runAllButton.disabled = false;
        runAllButton.classList.remove('opacity-60', 'cursor-not-allowed');
        runButtons.forEach(runButton => {
            runButton.disabled = false;
            runButton.classList.remove('opacity-60', 'cursor-not-allowed');
        });
    }
}

async function runReportingWorkflow(button, { fromRunAll = false } = {}) {
    if (!button || (isRunningSearchConsoleAll && !fromRunAll)) return { success: false, message: 'Run all is in progress.' };
    const row = button.closest('tr');
    const type = button.dataset.workflow;
    const client = appData.clients.find(item => item.id === row.dataset.clientId);
    const project = client?.projects.find(item => item.id === row.dataset.projectId);
    if (!client || !project) return { success: false, message: 'Project not found.' };

    const status = reportingStatus(type);
    const runButtons = [...document.querySelectorAll(`.reporting-run[data-workflow="${type}"]`)];
    if (!fromRunAll) runButtons.forEach(runButton => {
        runButton.disabled = true;
        runButton.classList.add('opacity-60', 'cursor-not-allowed');
    });
    status.textContent = 'Preparing…';
    try {
        if (type === 'searchConsole') {
            const workflow = window.reportingWorkflows.searchConsole;
            const settings = workflow.getSettings(project);
            const url = workflow.createLaunchUrl({
                scriptUrl: settings.scriptUrl,
                spreadsheetId: workflow.getSpreadsheetId(project),
                settings
            });
            const result = await window.electronAPI.launchUrlWithProfile({
                url,
                profileDir: client.chromeProfile?.directory || 'Default'
            });
            if (!result?.success) throw new Error(result?.error || 'Unable to open the client Apps Script.');
            status.textContent = `Search Console run started for ${project.name}.`;
            return { success: true };
        }
        throw new Error('Unknown reporting workflow.');
    } catch (error) {
        status.textContent = `Not run: ${error.message}`;
        return { success: false, message: error.message };
    } finally {
        if (!fromRunAll) runButtons.forEach(runButton => {
            runButton.disabled = false;
            runButton.classList.remove('opacity-60', 'cursor-not-allowed');
        });
    }
}

function showSectionView(type) {
    currentClientId = null;
    document.getElementById('add-client-btn').classList.add('hidden');
    document.getElementById('add-project-btn').classList.add('hidden');
    clientsView.classList.add('hidden');
    workspaceView.classList.add('hidden');
    sectionView.classList.remove('hidden');
    sectionView.classList.add('animate-in', 'fade-in', 'slide-in-from-right-4', 'duration-200');
    document.getElementById('search-input').parentElement.classList.add('hidden');
    const analyticsView = type === 'analytics';
    document.getElementById('search-console-panel').classList.toggle('hidden', analyticsView);
    document.getElementById('analytics-panel').classList.toggle('hidden', !analyticsView);
    if (analyticsView) renderAnalyticsSection();
    else renderReportingSection('searchConsole');
}

function openClientWorkspace(id) {
    currentClientId = id;
    document.getElementById('add-client-btn').classList.add('hidden');
    document.getElementById('add-project-btn').classList.remove('hidden');
    clientsView.classList.add('hidden');
    sectionView.classList.add('hidden');
    workspaceView.classList.remove('hidden');
    workspaceView.classList.add('animate-in', 'fade-in', 'slide-in-from-right-4', 'duration-200');

    // Hide global search to avoid confusion
    document.getElementById('search-input').parentElement.classList.add('hidden');

    renderProjects();
}

// Go
init();
