/**
 * 基金浏览器主应用
 */

const App = {
    // 状态
    state: {
        funds: [],        // 自选基金代码列表
        fundData: [],     // 基金实时数据
        sha: null,        // GitHub 文件 SHA
        isLoading: false,
        searchTimeout: null,
        sortMode: 0       // 0: 默认预设排序, 1: 涨跌幅从高到低, 2: 涨跌幅从低到高
    },

    // DOM 元素
    elements: {},

    /**
     * 初始化应用
     */
    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadData();
    },

    /**
     * 缓存 DOM 元素
     */
    cacheElements() {
        this.elements = {
            fundList: document.getElementById('fundList'),
            fundCount: document.getElementById('fundCount'),
            loading: document.getElementById('loading'),
            empty: document.getElementById('empty'),
            searchInput: document.getElementById('searchInput'),
            searchResults: document.getElementById('searchResults'),
            clearSearch: document.getElementById('clearSearch'),
            refreshBtn: document.getElementById('refreshBtn'),
            sortBtn: document.getElementById('sortBtn'),
            sortIcon: document.getElementById('sortIcon'),
            sortText: document.getElementById('sortText'),
            toast: document.getElementById('toast')
        };
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 搜索
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e));
        this.elements.clearSearch.addEventListener('click', () => this.clearSearch());

        // 点击外部关闭搜索结果
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search')) {
                this.elements.searchResults.classList.remove('active');
            }
        });

        // 刷新和排序
        this.elements.refreshBtn.addEventListener('click', () => this.refreshData());
        this.elements.sortBtn.addEventListener('click', () => this.toggleSort());

        // 拖拽排序逻辑
        let dragSourceCode = null;

        this.elements.fundList.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.fund-card');
            if (card) {
                // 如果不是默认排序，尽量保持原来的排序交互，或者可以不允许拖拽
                // 这里我们允许拖拽，并在拖拽后切换回默认排序
                dragSourceCode = card.dataset.code;
                card.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragSourceCode);
            }
        });

        this.elements.fundList.addEventListener('dragend', (e) => {
            const card = e.target.closest('.fund-card');
            if (card) {
                card.style.opacity = '1';
            }
        });

        this.elements.fundList.addEventListener('dragover', (e) => {
            const card = e.target.closest('.fund-card');
            if (card) {
                e.preventDefault(); // 必需，否则无法触发 drop
                e.dataTransfer.dropEffect = 'move';
            }
        });

        this.elements.fundList.addEventListener('drop', (e) => {
            e.preventDefault();
            const card = e.target.closest('.fund-card');
            if (!card || !dragSourceCode) return;
            
            const targetCode = card.dataset.code;
            if (dragSourceCode === targetCode) return;

            const sourceIndex = this.state.funds.indexOf(dragSourceCode);
            const targetIndex = this.state.funds.indexOf(targetCode);

            if (sourceIndex !== -1 && targetIndex !== -1) {
                // 在数组中移动元素
                this.state.funds.splice(sourceIndex, 1);
                this.state.funds.splice(targetIndex, 0, dragSourceCode);
                this.saveToLocal();
                
                if (window.GitHubAPI && GitHubAPI.isConfigured()) {
                    this.syncToGitHub(true);
                }

                // 拖拽后自动切换为预设排序
                this.state.sortMode = 0;
                this.render();
            }
        });
    },

    /**
     * 切换排序模式
     */
    toggleSort() {
        this.state.sortMode = (this.state.sortMode + 1) % 3;
        this.render();
    },

    /**
     * 加载数据
     */
    async loadData() {
        this.showLoading(true);

        try {
            // 先尝试从 GitHub 加载
            if (GitHubAPI.isConfigured()) {
                try {
                    const { content, sha } = await GitHubAPI.readFile();
                    this.state.funds = content.funds || [];
                    this.state.sha = sha;
                } catch (error) {
                    console.warn('从 GitHub 加载失败，使用本地数据:', error);
                    await this.loadFromLocal();
                }
            } else {
                // 从 localStorage 或 data/funds.json 加载
                await this.loadFromLocal();
            }

            // 获取实时数据
            if (this.state.funds.length > 0) {
                this.state.fundData = await FundAPI.getMultipleFunds(this.state.funds);
            }

            this.render();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showToast('加载失败: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 从 localStorage 加载数据。如果没有，尝试从本地文件系统加载
     */
    async loadFromLocal() {
        const saved = localStorage.getItem('fund_list');
        if (saved) {
            try {
                this.state.funds = JSON.parse(saved);
            } catch (e) {
                this.state.funds = [];
            }
        }

        // 如果 localStorage 里没有数据，尝试读取 data/funds.json 的初始数据
        if (this.state.funds.length === 0) {
            try {
                const response = await fetch('data/funds.json');
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.funds && Array.isArray(data.funds)) {
                        this.state.funds = data.funds;
                        this.saveToLocal(); // 保存到 localStorage 中，供下次使用
                        console.log('已从 data/funds.json 加载初始基金列表', data.funds);
                    }
                }
            } catch (e) {
                console.warn('无法读取初始数据配置 (data/funds.json):', e);
            }
        }
    },

    /**
     * 保存到 localStorage
     */
    saveToLocal() {
        localStorage.setItem('fund_list', JSON.stringify(this.state.funds));
    },

    /**
     * 刷新数据
     */
    async refreshData() {
        if (this.state.isLoading) return;

        const btn = this.elements.refreshBtn;
        btn.classList.add('loading');

        try {
            this.state.fundData = await FundAPI.getMultipleFunds(this.state.funds);
            this.render();
            this.showToast('刷新成功', 'success');
        } catch (error) {
            this.showToast('刷新失败: ' + error.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    /**
     * 搜索处理
     */
    handleSearch(e) {
        const keyword = e.target.value.trim();

        // 防抖
        clearTimeout(this.state.searchTimeout);

        if (!keyword) {
            this.elements.searchResults.classList.remove('active');
            return;
        }

        this.state.searchTimeout = setTimeout(async () => {
            const results = await FundAPI.searchFunds(keyword);
            this.renderSearchResults(results);
        }, 300);
    },

    /**
     * 渲染搜索结果
     */
    renderSearchResults(results) {
        if (!results.length) {
            this.elements.searchResults.innerHTML = `
                <div class="search__item" style="justify-content: center; color: var(--text-muted);">
                    未找到相关基金
                </div>
            `;
        } else {
            this.elements.searchResults.innerHTML = results.map(fund => {
                const isAdded = this.state.funds.includes(fund.code);
                return `
                    <div class="search__item" data-code="${fund.code}">
                        <div class="search__item-info">
                            <div class="search__item-name">${fund.name}</div>
                            <div class="search__item-code">${fund.code} · ${fund.type}</div>
                        </div>
                        <button class="search__item-add ${isAdded ? 'added' : ''}" 
                                onclick="App.addFund('${fund.code}')"
                                ${isAdded ? 'disabled' : ''}>
                            ${isAdded ? '✓' : '+'}
                        </button>
                    </div>
                `;
            }).join('');
        }

        this.elements.searchResults.classList.add('active');
    },

    /**
     * 清除搜索
     */
    clearSearch() {
        this.elements.searchInput.value = '';
        this.elements.searchResults.classList.remove('active');
    },

    /**
     * 添加基金
     */
    async addFund(code) {
        if (this.state.funds.includes(code)) return;

        this.state.funds.push(code);
        this.saveToLocal();

        // 获取新基金数据
        const newFundData = await FundAPI.getFundRealtime(code);
        if (newFundData) {
            this.state.fundData.push(newFundData);
        }

        this.render();
        this.renderSearchResults(await FundAPI.searchFunds(this.elements.searchInput.value));
        this.showToast('添加成功', 'success');

        // 自动同步到 GitHub
        if (GitHubAPI.isConfigured()) {
            this.syncToGitHub(true);
        }
    },

    /**
     * 删除基金
     */
    async removeFund(code) {
        const index = this.state.funds.indexOf(code);
        if (index === -1) return;

        this.state.funds.splice(index, 1);
        this.state.fundData = this.state.fundData.filter(f => f.code !== code);
        this.saveToLocal();
        this.render();
        this.showToast('已删除', 'success');

        // 自动同步到 GitHub
        if (GitHubAPI.isConfigured()) {
            this.syncToGitHub(true);
        }
    },

    /**
     * 同步到 GitHub
     */
    async syncToGitHub(silent = false) {
        if (!GitHubAPI.isConfigured()) {
            if (!silent) {
                this.showToast('请先配置 GitHub 设置', 'error');
            }
            return;
        }

        try {
            await GitHubAPI.syncFunds(this.state.funds);
            if (!silent) {
                this.showToast('同步成功', 'success');
            }
        } catch (error) {
            if (!silent) {
                this.showToast('同步失败: ' + error.message, 'error');
            }
            console.error('同步到 GitHub 失败:', error);
        }
    },

    /**
     * 渲染基金列表
     */
    render() {
        this.elements.fundCount.textContent = this.state.funds.length;

        if (this.state.funds.length === 0) {
            this.elements.empty.style.display = 'flex';
            // 移除已有的基金卡片
            const cards = this.elements.fundList.querySelectorAll('.fund-card');
            cards.forEach(card => card.remove());
            return;
        }

        this.elements.empty.style.display = 'none';

        // 更新排序图标和文字
        if (this.state.sortMode === 0) {
            this.elements.sortText.textContent = '默认排序';
            this.elements.sortIcon.innerHTML = `
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
            `;
        } else if (this.state.sortMode === 1) {
            this.elements.sortText.textContent = '高到低';
            this.elements.sortIcon.innerHTML = `
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
            `;
        } else {
            this.elements.sortText.textContent = '低到高';
            this.elements.sortIcon.innerHTML = `
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
            `;
        }

        // 根据排序模式排序
        const sortedData = [...this.state.fundData].sort((a, b) => {
            if (this.state.sortMode === 0) {
                // 按 this.state.funds(用户预设) 的顺序排序
                return this.state.funds.indexOf(a.code) - this.state.funds.indexOf(b.code);
            } else if (this.state.sortMode === 1) {
                // 从高到低
                return (b.estimateChange || 0) - (a.estimateChange || 0);
            } else {
                // 从低到高
                return (a.estimateChange || 0) - (b.estimateChange || 0);
            }
        });

        const html = sortedData.map((fund, index) => {
            const change = fund.estimateChange || 0;
            const changeClass = change >= 0 ? 'rise' : 'fall';
            const changeText = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;

            // 在自选默认排序模式下可能需要显示索引或者允许拖拽
            return `
                <div class="fund-card ${changeClass}" data-code="${fund.code}" draggable="true">
                    <div class="fund-card__info" style="cursor: move;">
                        <div class="fund-card__name">${fund.name}</div>
                        <div class="fund-card__code">${fund.code}</div>
                    </div>
                    <div class="fund-card__prev">
                        <div class="fund-card__prev-value">${fund.netValue?.toFixed(4) || '-'}</div>
                        <div class="fund-card__prev-label">前日净值</div>
                    </div>
                    <div class="fund-card__estimate">
                        <div class="fund-card__estimate-value">${fund.estimateValue?.toFixed(4) || '-'}</div>
                        <div class="fund-card__estimate-change">${changeText}</div>
                    </div>
                    <button class="fund-card__delete" onclick="App.removeFund('${fund.code}')" aria-label="删除">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

        // 保留loading和empty，替换其他内容
        const existingCards = this.elements.fundList.querySelectorAll('.fund-card');
        existingCards.forEach(card => card.remove());

        this.elements.fundList.insertAdjacentHTML('beforeend', html);
    },

    /**
     * 显示/隐藏加载状态
     */
    showLoading(show) {
        this.state.isLoading = show;
        this.elements.loading.style.display = show ? 'flex' : 'none';
    },

    /**
     * 显示 Toast 提示
     */
    showToast(message, type = 'info') {
        const toast = this.elements.toast;
        toast.textContent = message;
        toast.className = 'toast active ' + type;

        setTimeout(() => {
            toast.classList.remove('active');
        }, 2500);
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());

// 导出供全局调用
window.App = App;
