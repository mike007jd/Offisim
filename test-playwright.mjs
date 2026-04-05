import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];

page.on('console', (msg) => {
  consoleMessages.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location(),
  });
});

page.on('pageerror', (error) => {
  pageErrors.push(error.message);
});

page.on('requestfailed', (request) => {
  consoleMessages.push({
    type: 'network-error',
    text: `${request.failure().errorText}: ${request.url()}`,
  });
});

try {
  console.log('=== 测试 1: 打开 Web App 首屏 ===');
  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const title = await page.title();
  console.log('页面标题:', title);

  const bodyText = await page.locator('body').innerText();
  console.log('首屏内容预览:', bodyText.substring(0, 500));

  await page.screenshot({ path: 'screenshots/01-homepage.png', fullPage: true });
  console.log('首屏截图已保存: screenshots/01-homepage.png');

  console.log('\n=== 测试 2: 检查页面可交互元素 ===');
  const buttons = await page.locator('button').all();
  console.log(`找到 ${buttons.length} 个按钮`);

  const inputs = await page.locator('input').all();
  console.log(`找到 ${inputs.length} 个输入框`);

  const links = await page.locator('a').all();
  console.log(`找到 ${links.length} 个链接`);

  const tabs = await page.locator('[role="tab"]').all();
  console.log(`找到 ${tabs.length} 个 Tab`);

  const sidebars = await page.locator('[role="navigation"]').all();
  console.log(`找到 ${sidebars.length} 个导航区`);

  console.log('\n=== 测试 3: 点击第一个可见按钮 ===');
  if (buttons.length > 0) {
    const firstButton = buttons[0];
    const buttonText = await firstButton.innerText();
    console.log(`点击按钮: "${buttonText}"`);
    await firstButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/02-after-button-click.png', fullPage: true });
    console.log('点击后截图已保存: screenshots/02-after-button-click.png');
  }

  console.log('\n=== 测试 4: 尝试点击 Tab (如果有) ===');
  if (tabs.length > 0) {
    for (let i = 0; i < Math.min(tabs.length, 3); i++) {
      const tab = tabs[i];
      const tabText = await tab.innerText();
      console.log(`点击 Tab ${i + 1}: "${tabText}"`);
      await tab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/03-tab-${i + 1}.png`, fullPage: true });
    }
  }

  console.log('\n=== 测试 5: 尝试在输入框输入内容 ===');
  if (inputs.length > 0) {
    const firstInput = inputs[0];
    await firstInput.fill('Test message for black box testing');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/04-after-input.png', fullPage: true });
    console.log('输入后截图已保存: screenshots/04-after-input.png');

    await firstInput.press('Enter');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/05-after-enter.png', fullPage: true });
    console.log('回车后截图已保存: screenshots/05-after-enter.png');
  }

  console.log('\n=== 测试 6: 窄屏响应式布局 ===');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/06-mobile-view.png', fullPage: true });
  console.log('窄屏截图已保存: screenshots/06-mobile-view.png');

  console.log('\n=== 测试 7: 测试 Drawer/Sidebar 展开 ===');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  const drawers = await page
    .locator('[role="dialog"], [role="complementary"], .drawer, aside')
    .all();
  console.log(`找到 ${drawers.length} 个抽屉/侧边栏`);

  const menuButtons = await page
    .locator(
      'button:has-text("Menu"), button:has-text("菜单"), button:has-text("导航"), [aria-label*="menu" i]',
    )
    .all();
  if (menuButtons.length > 0) {
    await menuButtons[0].click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/07-after-menu-click.png', fullPage: true });
    console.log('菜单点击后截图已保存: screenshots/07-after-menu-click.png');
  }

  console.log('\n=== 测试 8: 测试页面滚动 ===');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/08-after-scroll.png', fullPage: true });
  console.log('滚动后截图已保存: screenshots/08-after-scroll.png');

  console.log('\n=== 测试 9: 测试其他链接/按钮 ===');
  const allButtons = await page.locator('button').all();
  for (let i = 0; i < Math.min(allButtons.length, 5); i++) {
    try {
      const btn = allButtons[i];
      const isVisible = await btn.isVisible();
      if (isVisible) {
        const btnText = await btn.innerText();
        console.log(`点击可见按钮 ${i + 1}: "${btnText.substring(0, 30)}"`);
        await btn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `screenshots/09-button-${i + 1}.png`, fullPage: true });
      }
    } catch (e) {
      console.log(`按钮 ${i + 1} 点击失败: ${e.message}`);
    }
  }
} catch (error) {
  console.error('测试过程中发生错误:', error.message);
  await page.screenshot({ path: 'screenshots/error-state.png', fullPage: true });
  console.log('错误状态截图已保存: screenshots/error-state.png');
}

console.log('\n=== 控制台消息 ===');
console.log('Console messages:', consoleMessages.length);
consoleMessages.forEach((msg, i) => {
  console.log(`${i + 1}. [${msg.type}] ${msg.text}`);
});

console.log('\n=== 页面错误 ===');
console.log('Page errors:', pageErrors.length);
pageErrors.forEach((err, i) => {
  console.log(`${i + 1}. ${err}`);
});

await browser.close();
console.log('\n测试完成!');
