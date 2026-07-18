/* 启动（兼容脚本在 DOM 就绪后注入的宿主环境） */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UI.boot());
else UI.boot();
