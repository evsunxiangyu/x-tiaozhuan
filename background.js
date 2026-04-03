/**
 * X 新标签页打开 - Background Service Worker
 *
 * 管理插件启停状态，通过扩展图标一键切换。
 * 启用时：蓝色图标，无 badge
 * 关闭时：灰色图标，红色 OFF badge
 */

// ==================== 事件监听 ====================

// 点击扩展图标切换开关
chrome.action.onClicked.addListener(async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  const newState = !(enabled !== false);
  await chrome.storage.local.set({ enabled: newState });
  updateUI(newState);
  broadcastState(newState);
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ enabled: true });
  updateUI(true);
});

// 浏览器启动时同步 UI
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('enabled', (result) => {
    updateUI(result.enabled !== false);
  });
});

// ==================== UI 更新 ====================

function updateUI(enabled) {
  chrome.action.setIcon({ imageData: { 128: generateIcon(enabled) } });
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
  chrome.action.setTitle({
    title: enabled
      ? 'X 新标签页打开 - 已启用（点击关闭）'
      : 'X 新标签页打开 - 已关闭（点击启用）',
  });
}

// ==================== 图标生成 ====================

function generateIcon(enabled) {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  // 圆角矩形背景
  ctx.fillStyle = enabled ? '#1DA1F2' : '#999999';
  roundRect(ctx, 6, 6, size - 12, size - 12, 22);
  ctx.fill();

  // 箭头图标（白色）
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 对角线
  ctx.beginPath();
  ctx.moveTo(38, 90);
  ctx.lineTo(90, 38);
  ctx.stroke();

  // 箭头头部
  ctx.beginPath();
  ctx.moveTo(56, 38);
  ctx.lineTo(90, 38);
  ctx.lineTo(90, 72);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ==================== 状态广播 ====================

function broadcastState(enabled) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { enabled }).catch(() => {});
    }
  });
}
