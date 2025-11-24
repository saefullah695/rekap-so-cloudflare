// Konfigurasi Aplikasi
const CONFIG = {
    WORKER_URL: 'https://your-worker.your-subdomain.workers.dev',
    VERSION: '1.0.0',
    CACHE_KEYS: {
        ITEMS: 'cached_items',
        HISTORY: 'cached_history',
        SETTINGS: 'app_settings'
    }
};

// State Management
let appState = {
    items: [],
    history: [],
    settings: {},
    currentTab: 'dashboard'
};

// DOM Elements
const elements = {
    app: document.getElementById('app'),
    loading: document.getElementById('loading'),
    sideMenu: document.getElementById('sideMenu'),
    menuBtn: document.getElementById('menuBtn'),
    closeMenu: document.getElementById('closeMenu'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    closeModal: document.getElementById('closeModal')
};

// Inisialisasi Aplikasi
class RekapApp {
    constructor() {
        this.init();
    }

    async init() {
        try {
            // Load settings dari cache
            await this.loadSettings();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Load data awal
            await this.loadInitialData();
            
            // Sembunyikan loading screen
            this.hideLoading();
            
            // Tampilkan notifikasi welcome
            this.showToast('Aplikasi siap digunakan!', 'success');
            
        } catch (error) {
            console.error('Error initializing app:', error);
            this.showToast('Gagal memuat aplikasi', 'error');
        }
    }

    setupEventListeners() {
        // Navigation
        elements.menuBtn.addEventListener('click', () => this.toggleMenu());
        elements.closeMenu.addEventListener('click', () => this.toggleMenu());
        
        // Tab navigation
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
                this.toggleMenu();
            });
        });

        // Action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                if (tab) this.switchTab(tab);
            });
        });

        // Form submission
        document.getElementById('prosesRekapBtn').addEventListener('click', () => this.prosesRekap());
        document.getElementById('checkHppBtn').addEventListener('click', () => this.cekHpp());
        document.getElementById('syncBtn').addEventListener('click', () => this.syncData());
        document.getElementById('testConnection').addEventListener('click', () => this.testConnection());
        document.getElementById('clearCache').addEventListener('click', () => this.clearCache());
        document.getElementById('refreshData').addEventListener('click', () => this.refreshData());

        // Modal
        elements.closeModal.addEventListener('click', () => this.hideModal());
        elements.modal.addEventListener('click', (e) => {
            if (e.target === elements.modal) this.hideModal();
        });

        // Date default ke hari ini
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('tanggal').value = today;
        document.getElementById('filterDate').value = today;
    }

    async loadInitialData() {
        await Promise.all([
            this.loadItems(),
            this.loadHistory(),
            this.updateDashboard()
        ]);
    }

    async loadItems() {
        try {
            const response = await this.apiCall('/api/sheets?sheetName=MS&range=A:H');
            if (response.success) {
                appState.items = response.data.slice(1).map(row => ({
                    plu: row[0] || '',
                    descp: row[1] || '',
                    hpp: parseFloat(row[7]) || 0
                })).filter(item => item.plu);
                
                this.updateItemsCount();
                this.saveToCache(CONFIG.CACHE_KEYS.ITEMS, appState.items);
            }
        } catch (error) {
            console.error('Error loading items:', error);
            // Fallback ke cache
            const cached = await this.getFromCache(CONFIG.CACHE_KEYS.ITEMS);
            if (cached) appState.items = cached;
        }
    }

    async loadHistory() {
        try {
            // Implement history loading logic
            this.updateHistoryDisplay();
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    async updateDashboard() {
        document.getElementById('totalItems').textContent = appState.items.length;
        document.getElementById('totalItemsInfo').textContent = appState.items.length;
        
        // Update today's rekap count
        const today = new Date().toISOString().split('T')[0];
        // Implement logic to count today's rekap
        document.getElementById('todayRekap').textContent = '0';
        
        // Check zero HPP items
        const zeroHpp = appState.items.filter(item => item.hpp === 0).length;
        document.getElementById('zeroHpp').textContent = zeroHpp;
    }

    async prosesRekap() {
        const formData = this.getFormData();
        
        if (!this.validateForm(formData)) {
            return;
        }

        const button = document.getElementById('prosesRekapBtn');
        const originalText = button.innerHTML;
        
        try {
            button.innerHTML = '<span class="btn-icon">⏳</span> Memproses...';
            button.disabled = true;

            const hppValues = this.getHppValues();
            const payload = {
                type: formData.rekapType,
                tanggal: formData.tanggal,
                shift: formData.shift,
                operator: formData.operator,
                hppValues: hppValues
            };

            const response = await this.apiCall('/api/rekap', 'POST', payload);

            if (response.success) {
                this.showToast(response.message, 'success');
                this.resetForm();
                await this.loadInitialData();
            } else if (response.needHppInput) {
                this.showHppInputModal(response.needHppInput);
            }

        } catch (error) {
            console.error('Error processing rekap:', error);
            this.showToast(error.message, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    async cekHpp() {
        try {
            const response = await this.apiCall('/api/check-hpp');
            if (response.success && response.zeroHppItems.length > 0) {
                this.showHppInputModal(response.zeroHppItems);
            } else {
                this.showToast('Semua item sudah memiliki HPP', 'success');
            }
        } catch (error) {
            this.showToast('Gagal memeriksa HPP', 'error');
        }
    }

    showHppInputModal(items) {
        let html = `
            <div class="hpp-section">
                <p>${items.length} item membutuhkan input HPP manual:</p>
                <div class="hpp-list">
        `;

        items.forEach(item => {
            html += `
                <div class="hpp-item">
                    <div class="hpp-item-header">
                        <div class="hpp-item-info">
                            <div class="hpp-item-plu">${item.plu}</div>
                            <div class="hpp-item-desc">${item.descp}</div>
                        </div>
                    </div>
                    <input type="number" 
                           step="0.01" 
                           class="hpp-input" 
                           data-plu="${item.plu}"
                           placeholder="Masukkan HPP">
                </div>
            `;
        });

        html += `
                </div>
                <button id="saveHppBtn" class="btn btn-primary btn-large">
                    💾 Simpan HPP
                </button>
            </div>
        `;

        this.showModal('Input HPP Manual', html);

        document.getElementById('saveHppBtn').addEventListener('click', () => {
            this.saveHppValues(items);
        });
    }

    saveHppValues(items) {
        const hppValues = {};
        let allFilled = true;

        items.forEach(item => {
            const input = document.querySelector(`.hpp-input[data-plu="${item.plu}"]`);
            const value = parseFloat(input.value);
            
            if (!value || value <= 0) {
                allFilled = false;
                input.style.borderColor = 'var(--danger)';
            } else {
                hppValues[item.plu] = value;
                input.style.borderColor = 'var(--success)';
            }
        });

        if (!allFilled) {
            this.showToast('Isi semua nilai HPP dengan angka positif', 'warning');
            return;
        }

        // Simpan HPP values ke state dan lanjutkan proses rekap
        this.hideModal();
        this.showHppSection(hppValues);
        this.showToast('HPP berhasil disimpan', 'success');
    }

    showHppSection(hppValues) {
        const section = document.getElementById('hppSection');
        const list = document.getElementById('hppList');
        
        list.innerHTML = '';
        Object.keys(hppValues).forEach(plu => {
            const item = appState.items.find(i => i.plu === plu);
            if (item) {
                list.innerHTML += `
                    <div class="hpp-item">
                        <div class="hpp-item-header">
                            <div class="hpp-item-info">
                                <div class="hpp-item-plu">${plu}</div>
                                <div class="hpp-item-desc">${item.descp}</div>
                            </div>
                            <span class="hpp-value">💰 ${hppValues[plu]}</span>
                        </div>
                    </div>
                `;
            }
        });
        
        section.classList.remove('hidden');
    }

    getFormData() {
        return {
            tanggal: document.getElementById('tanggal').value,
            shift: document.getElementById('shift').value,
            operator: document.getElementById('operator').value,
            rekapType: document.getElementById('rekapType').value
        };
    }

    validateForm(data) {
        if (!data.tanggal) {
            this.showToast('Pilih tanggal terlebih dahulu', 'warning');
            return false;
        }
        if (!data.shift) {
            this.showToast('Pilih shift terlebih dahulu', 'warning');
            return false;
        }
        if (!data.operator) {
            this.showToast('Isi nama operator terlebih dahulu', 'warning');
            return false;
        }
        return true;
    }

    getHppValues() {
        const inputs = document.querySelectorAll('.hpp-input');
        const values = {};
        inputs.forEach(input => {
            if (input.value) {
                values[input.dataset.plu] = parseFloat(input.value);
            }
        });
        return values;
    }

    resetForm() {
        document.getElementById('rekapForm').reset();
        document.getElementById('hppSection').classList.add('hidden');
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('tanggal').value = today;
    }

    async syncData() {
        this.showToast('Menyinkronisasi data...', 'info');
        await this.loadInitialData();
        this.showToast('Data berhasil disinkronisasi', 'success');
    }

    async testConnection() {
        try {
            const response = await this.apiCall('/api/health');
            document.getElementById('sheetsStatus').textContent = 'Online';
            document.getElementById('sheetsStatus').className = 'status-badge online';
            this.showToast('Koneksi berhasil', 'success');
        } catch (error) {
            document.getElementById('sheetsStatus').textContent = 'Offline';
            document.getElementById('sheetsStatus').className = 'status-badge offline';
            this.showToast('Koneksi gagal', 'error');
        }
    }

    async clearCache() {
        await this.clearAllCache();
        this.showToast('Cache berhasil dihapus', 'success');
        await this.loadInitialData();
    }

    async refreshData() {
        await this.clearCache();
        await this.loadInitialData();
    }

    // Utility Methods
    async apiCall(endpoint, method = 'GET', data = null) {
        const url = CONFIG.WORKER_URL + endpoint;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-app-version': CONFIG.VERSION
            }
        };

        if (data && method !== 'GET') {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    showToast(message, type = 'info') {
        elements.toastMessage.textContent = message;
        elements.toast.className = `toast ${type}`;
        elements.toast.classList.remove('hidden');
        
        setTimeout(() => {
            elements.toast.classList.add('hidden');
        }, 3000);
    }

    showModal(title, content) {
        elements.modalTitle.textContent = title;
        elements.modalBody.innerHTML = content;
        elements.modal.classList.remove('hidden');
    }

    hideModal() {
        elements.modal.classList.add('hidden');
    }

    toggleMenu() {
        elements.sideMenu.classList.toggle('active');
    }

    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Remove active class from all menu items
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Show selected tab
        document.getElementById(tabName).classList.add('active');
        
        // Activate corresponding menu item
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        appState.currentTab = tabName;
    }

    hideLoading() {
        elements.loading.classList.add('hidden');
        elements.app.classList.remove('hidden');
    }

    updateItemsCount() {
        const elements = ['totalItems', 'totalItemsInfo'];
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = appState.items.length;
            }
        });
    }

    updateHistoryDisplay() {
        // Implement history display update
    }

    // Cache Management
    async saveToCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to save to cache:', error);
        }
    }

    async getFromCache(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.warn('Failed to get from cache:', error);
            return null;
        }
    }

    async clearAllCache() {
        try {
            Object.values(CONFIG.CACHE_KEYS).forEach(key => {
                localStorage.removeItem(key);
            });
        } catch (error) {
            console.warn('Failed to clear cache:', error);
        }
    }

    async loadSettings() {
        const settings = await this.getFromCache(CONFIG.CACHE_KEYS.SETTINGS) || {};
        appState.settings = settings;
        
        // Update app version
        document.getElementById('appVersion').textContent = CONFIG.VERSION;
    }
}

// PWA Support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new RekapApp();
});

// Handle offline/online status
window.addEventListener('online', () => {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#10b981');
});

window.addEventListener('offline', () => {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#ef4444');
});
