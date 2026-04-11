/**
 * X 新标签页打开 - Content Script
 *
 * 在 capture 阶段拦截推文点击，阻止 SPA 导航，改为新标签页打开。
 * 处理流程：
 *   1. 图片 → 放行（X 原生放大）
 *   2. 链接 → 外链放行，status 链接按规则处理
 *   3. 嵌套推文 → 阻止跳转，新标签打开引用推文
 *   4. 引用推文卡片 → 阻止跳转，新标签打开引用推文
 *   5. role="link" 卡片 → 阻止跳转，新标签打开引用推文
 *   6. 交互按钮 → 放行
 *   7. 提取推文 URL → 详情页仅阻止 / 列表页新标签打开
 */

(function () {
  'use strict';

  // ==================== 开关状态 ====================

  let enabled = true;

  chrome.storage.local.get('enabled', (result) => {
    enabled = result.enabled !== false;
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.hasOwnProperty('enabled')) {
      enabled = message.enabled;
    }
  });

  // ==================== 选择器常量 ====================

  // 交互按钮（点击这些不触发拦截）
  const ACTION_SELECTORS = [
    '[data-testid="reply"]',
    '[data-testid="retweet"]',
    '[data-testid="like"]',
    '[data-testid="bookmark"]',
    '[data-testid="shareBtn"]',
    '[data-testid="tweetButtonInline"]',
    '[role="button"]',
    '[data-testid="placementTracking"]',
    '[data-testid="tweetInterstitial"]',
    'input',
    'textarea',
    'button',
  ].join(',');

  // 引用推文 / 原贴卡片
  const NESTED_TWEET_SELECTORS = [
    '[data-testid="quoteTweet"]',
    '[data-testid="Tweet-User-Avatar"]',
  ].join(',');

  // 图片区域（不拦截，保留 X 原生放大功能）
  const IMAGE_SELECTORS = [
    '[data-testid="tweetPhoto"]',
    'a[href*="/photo/"]',
  ].join(',');

  // ==================== 工具函数 ====================

  /** 从推文 article 中提取推文自身 URL */
  function extractTweetUrl(tweet) {
    const timeLink = tweet.querySelector('time a[href*="/status/"]');
    if (timeLink) return timeLink.getAttribute('href');
    const statusLink = tweet.querySelector('a[href*="/status/"]');
    if (statusLink) return statusLink.getAttribute('href');
    return null;
  }

  /** 从引用推文区域提取链接的推文 URL，扩大搜索范围到父容器 */
  function extractQuotedTweetUrl(target) {
    // 1. 从 quoteTweet 或 role="link" 容器内找
    const container = target.closest('[data-testid="quoteTweet"]') || target.closest('[role="link"]');
    if (container) {
      const statusLink = container.querySelector('a[href*="/status/"]');
      if (statusLink) return statusLink.getAttribute('href');
    }

    // 2. 检查父元素（链接可能是兄弟节点而非容器内部）
    const parent = container ? container.parentElement : target.parentElement;
    if (parent) {
      // 父元素本身是 <a>
      if (parent.tagName === 'A') {
        const href = parent.getAttribute('href') || '';
        if (href.includes('/status/')) return href;
      }
      // 在父元素内搜索
      const statusLink = parent.querySelector(':scope > a[href*="/status/"]');
      if (statusLink) return statusLink.getAttribute('href');
    }

    return null;
  }

  /** 构建完整 URL */
  function buildFullUrl(href) {
    return href.startsWith('http') ? href : 'https://x.com' + href;
  }

  /** 阻止事件传播和默认行为 */
  function blockEvent(event) {
    event.stopPropagation();
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  /** 在详情页查找 URL 中 status ID 对应的主推文 article */
  function findMainTweetArticle(statusId) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const timeLink = article.querySelector('time a[href*="/status/"]');
      if (timeLink) {
        const href = timeLink.getAttribute('href');
        const match = href.match(/\/status\/(\d+)/);
        if (match && match[1] === statusId) return article;
      }
    }
    return null;
  }

  /** 从当前页面 URL 提取 status ID */
  function getCurrentStatusId() {
    const match = window.location.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  // ==================== 点击拦截 ====================

  document.addEventListener(
    'click',
    function (event) {
      if (event.button !== 0 || !enabled) return;

      const target = event.target;
      const tweet = target.closest('article[data-testid="tweet"]');
      if (!tweet) return;

      // ---- 1. 图片点击：放行，让 X 原生放大 ----
      if (target.closest(IMAGE_SELECTORS)) return;

      // ---- 2. 链接点击（优先于 block 检查，保护引用推文内的外链） ----
      const clickedLink = target.closest('a');
      if (clickedLink) {
        const linkHref = clickedLink.getAttribute('href') || '';
        // 外部链接、用户主页、话题标签 → 放行
        if (!linkHref.includes('/status/')) return;
        // 指向 /status/ 的链接：其他推文 → 阻止并新标签打开；自身 → 继续往下
        const tweetUrl = extractTweetUrl(tweet);
        if (tweetUrl && linkHref !== tweetUrl) {
          blockEvent(event);
          window.open(buildFullUrl(linkHref), '_blank');
          return;
        }
      }

      // ---- 3. 嵌套推文（article 内的 article）：提取 URL 并新标签打开 ----
      if (tweet.parentElement?.closest('article[data-testid="tweet"]')) {
        blockEvent(event);
        const quotedUrl = extractTweetUrl(tweet);
        if (quotedUrl) window.open(buildFullUrl(quotedUrl), '_blank');
        return;
      }

      // ---- 4. 引用推文卡片：提取 URL 并新标签打开 ----
      if (target.closest(NESTED_TWEET_SELECTORS)) {
        blockEvent(event);
        const quotedUrl = extractQuotedTweetUrl(target);
        if (quotedUrl) window.open(buildFullUrl(quotedUrl), '_blank');
        return;
      }

      // ---- 5. role="link" 可点击卡片：提取 URL 并新标签打开 ----
      if (
        target.closest('[role="link"]') &&
        target.closest('[role="link"]') !== tweet &&
        !clickedLink
      ) {
        const quotedUrl = extractQuotedTweetUrl(target);
        if (quotedUrl) {
          blockEvent(event);
          window.open(buildFullUrl(quotedUrl), '_blank');
          return;
        }
        // 找不到 URL 时不阻止，让 X 原生处理（当前页跳转）
        return;
      }

      // ---- 6. 交互按钮：放行 ----
      if (target.closest(ACTION_SELECTORS)) return;

      // ---- 7. 提取推文 URL ----
      const href = extractTweetUrl(tweet);
      if (!href) {
        if (getCurrentStatusId()) blockEvent(event);
        return;
      }

      // ---- 8. 详情页处理 ----
      const currentId = getCurrentStatusId();
      if (currentId) {
        const hrefMatch = href.match(/\/status\/(\d+)/);
        if (hrefMatch) {
          // 8a. 点击当前页面展示的推文 → 仅阻止，不打开新标签
          if (hrefMatch[1] === currentId) {
            blockEvent(event);
            return;
          }
          // 8b. 点击原贴（DOM 中位于主推文之前）→ 仅阻止
          const mainArticle = findMainTweetArticle(currentId);
          if (
            mainArticle &&
            tweet !== mainArticle &&
            tweet.compareDocumentPosition(mainArticle) & Node.DOCUMENT_POSITION_FOLLOWING
          ) {
            blockEvent(event);
            return;
          }
        }
      }

      // ---- 9. 默认：阻止跳转，新标签页打开 ----
      blockEvent(event);
      window.open(buildFullUrl(href), '_blank');
    },
    true // capture 阶段，先于 React 执行
  );

  console.log('[X 新标签页打开] content script 已加载');
})();
