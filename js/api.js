/**
 * 基金数据 API 封装
 * 支持天天基金新版 H5 批量估值接口（FundValuationLast），主域失败自动切换备用域名
 */

const FundAPI = {
    // 基金代码列表缓存
    fundList: null,

    // 天天基金新版 H5 估值主域名与备用域名
    VALUATION_API_PRIMARY: 'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast',
    VALUATION_API_BACKUP: 'https://fundcomapi.eastmoney.com/mm/newCore/FundValuationLast',

    /**
     * 加载所有基金代码列表（用于搜索）
     * 数据源：https://fund.eastmoney.com/js/fundcode_search.js
     */
    async loadFundList() {
        if (this.fundList) return this.fundList;

        return new Promise((resolve) => {
            if (window.r && Array.isArray(window.r)) {
                this.fundList = window.r.map(item => ({
                    code: item[0],
                    spell: item[1],
                    name: item[2],
                    type: item[3],
                    pinyin: item[4]
                }));
                return resolve(this.fundList);
            }

            const script = document.createElement('script');
            script.src = 'https://fund.eastmoney.com/js/fundcode_search.js';

            script.onload = () => {
                if (window.r && Array.isArray(window.r)) {
                    this.fundList = window.r.map(item => ({
                        code: item[0],
                        spell: item[1],
                        name: item[2],
                        type: item[3],
                        pinyin: item[4]
                    }));
                    console.log(`已加载 ${this.fundList.length} 只基金`);
                    resolve(this.fundList);
                } else {
                    resolve([]);
                }
                if (script.parentNode) script.parentNode.removeChild(script);
            };

            script.onerror = () => {
                console.warn('加载基金列表失败');
                if (script.parentNode) script.parentNode.removeChild(script);
                resolve([]);
            };

            document.head.appendChild(script);
        });
    },

    /**
     * 搜索基金（本地过滤）
     * @param {string} keyword - 代码、名称或拼音
     * @param {number} limit - 返回结果数量限制
     */
    async searchFunds(keyword, limit = 20) {
        const list = await this.loadFundList();
        if (!keyword || !list.length) return [];

        const kw = keyword.toLowerCase();
        const results = list.filter(fund =>
            fund.code.includes(kw) ||
            fund.name.toLowerCase().includes(kw) ||
            fund.spell.toLowerCase().includes(kw) ||
            fund.pinyin.toLowerCase().includes(kw)
        );

        return results.slice(0, limit);
    },

    /**
     * 尝试请求估值 API
     * @param {string} baseUrl - 主域名或备用域名 URL
     * @param {string[]} codes - 基金代码数组
     */
    async fetchValuationApi(baseUrl, codes) {
        const fields = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE';
        const url = `${baseUrl}?FCODES=${codes.join(',')}&FIELDS=${fields}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        const resData = await response.json();
        if (resData && resData.success && Array.isArray(resData.data)) {
            return resData.data;
        }
        throw new Error('返回数据格式无效');
    },

    /**
     * 从 pingzhongdata 兜底接口获取单只基金净值数据
     * @param {string} code - 基金代码
     */
    async getFundFromPingzhongData(code) {
        return new Promise((resolve) => {
            const timestamp = Date.now();
            const script = document.createElement('script');
            script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${timestamp}`;

            let isResolved = false;

            const handleSuccess = () => {
                if (isResolved) return;
                isResolved = true;
                try {
                    if (typeof Data_netWorthTrend !== 'undefined' && Array.isArray(Data_netWorthTrend) && Data_netWorthTrend.length > 0) {
                        const trend = Data_netWorthTrend;
                        const latest = trend[trend.length - 1];
                        const prev = trend.length > 1 ? trend[trend.length - 2] : latest;
                        const fundName = (typeof fS_name !== 'undefined' && fS_name) ? fS_name : code;
                        const dateStr = latest.x ? new Date(latest.x).toLocaleDateString('zh-CN') : '';

                        resolve({
                            code: code,
                            name: fundName,
                            netValue: prev ? parseFloat(prev.y) : parseFloat(latest.y),
                            estimateValue: parseFloat(latest.y),
                            estimateChange: parseFloat(latest.equityReturn),
                            valueDate: dateStr,
                            estimateTime: dateStr
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    console.error(`解析基金 ${code} pingzhongdata 出错:`, e);
                    resolve(null);
                } finally {
                    window.Data_netWorthTrend = undefined;
                    window.fS_name = undefined;
                    if (script.parentNode) script.parentNode.removeChild(script);
                }
            };

            script.onload = handleSuccess;
            script.onerror = () => {
                if (isResolved) return;
                isResolved = true;
                if (script.parentNode) script.parentNode.removeChild(script);
                resolve(null);
            };

            document.head.appendChild(script);
        });
    },

    /**
     * 获取单只基金数据
     * @param {string} code - 基金代码
     */
    async getFundRealtime(code) {
        const results = await this.getMultipleFunds([code]);
        return results && results.length > 0 ? results[0] : null;
    },

    /**
     * 批量获取多只基金数据
     * 一次性使用 FCODES 批量请求整个分组。主域失败自动切换至 fundcomapi.eastmoney.com 备用域名。
     * 对于估值返回 null 的基金，保留名称 SHORTNAME 和正式净值 NAV，日涨跌幅设为 null (前端展示为“暂无”)。
     * @param {string[]} codes - 基金代码数组
     */
    async getMultipleFunds(codes) {
        if (!codes || !codes.length) return [];

        let items = null;

        // 1. 尝试主域名批量请求
        try {
            items = await this.fetchValuationApi(this.VALUATION_API_PRIMARY, codes);
        } catch (primaryErr) {
            console.warn('主域名请求失败，尝试切换至备用域名 (fundcomapi.eastmoney.com):', primaryErr.message);
            // 2. 尝试备用域名批量请求
            try {
                items = await this.fetchValuationApi(this.VALUATION_API_BACKUP, codes);
            } catch (backupErr) {
                console.warn('备用域名请求亦失败，降级使用 pingzhongdata 脚本模式:', backupErr.message);
            }
        }

        let valuationMap = {};
        if (items && Array.isArray(items)) {
            items.forEach(item => {
                valuationMap[item.FCODE] = item;
            });
        }

        const finalResults = [];

        for (const code of codes) {
            const valItem = valuationMap[code];

            if (valItem) {
                const navVal = (valItem.NAV !== null && valItem.NAV !== undefined) ? parseFloat(valItem.NAV) : null;
                const gszVal = (valItem.GSZ !== null && valItem.GSZ !== undefined) ? parseFloat(valItem.GSZ) : navVal;
                const gszzlVal = (valItem.GSZZL !== null && valItem.GSZZL !== undefined) ? parseFloat(valItem.GSZZL) : null;

                finalResults.push({
                    code: valItem.FCODE || code,
                    name: valItem.SHORTNAME || code,
                    netValue: navVal,
                    estimateValue: gszVal,
                    estimateChange: gszzlVal,  // null 时前端展示为“暂无”
                    valueDate: valItem.PDATE || '',
                    estimateTime: valItem.GZTIME || valItem.PDATE || ''
                });
            } else {
                // 若 API 没有任何数据，降级从 pingzhongdata 获取
                const pingData = await this.getFundFromPingzhongData(code);
                if (pingData) {
                    finalResults.push(pingData);
                }
            }
        }

        return finalResults;
    }
};

// 导出
window.FundAPI = FundAPI;
