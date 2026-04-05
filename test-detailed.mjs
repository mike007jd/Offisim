import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];
const networkErrors = [];

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

page.on('response', (response) => {
  if (!response.ok() && response.status() >= 400) {
    networkErrors.push(`${response.status()} ${response.statusText()}: ${response.url()}`);
  }
});

page.on('requestfailed', (request) => {
  networkErrors.push(`Failed: ${request.failure().errorText} - ${request.url()}`);
});

try {
  console.log('=== 详细测试: AI Company Simulator ===\n');

  console.log('步骤 1: 打开应用');
  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/detailed-01-app-loaded.png', fullPage: true });
  console.log('✓ 应用已加载');

  console.log('\n步骤 2: 检查主界面元素');
  const pageContent = await page.locator('body').innerText();
  console.log('主界面文本预览:', pageContent.substring(0, 300));

  console.log('\n步骤 3: 点击 "New" 按钮');
  const newButton = page.locator('button:has-text("New")');
  if (await newButton.isVisible()) {
    await newButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/detailed-02-new-modal.png', fullPage: true });
    console.log('✓ New 模态框已打开');
  }

  console.log('\n步骤 4: 检查模态框内容');
  const modalContent = await page
    .locator('[role="dialog"], .fixed.inset-0')
    .first()
    .innerText()
    .catch(() => '未找到模态框内容');
  console.log('模态框内容:', modalContent.substring(0, 500));

  console.log('\n步骤 5: 在模态框中查找表单元素');
  const inputs = await page.locator('input, textarea').all();
  console.log(`找到 ${inputs.length} 个输入字段`);

  const modalButtons = await page.locator('[role="dialog"] button, .fixed button').all();
  console.log(`找到 ${modalButtons.length} 个按钮`);

  console.log('\n步骤 6: 填写公司名称');
  const nameInput = page
    .locator('input[placeholder*="name" i], input[placeholder*="Name" i], input[type="text"]')
    .first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('Test Company');
    console.log('✓ 已填写公司名称: Test Company');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/detailed-03-name-filled.png', fullPage: true });
  }

  console.log('\n步骤 7: 尝试创建公司');
  const createButton = page
    .locator(
      'button:has-text("Create"), button:has-text("创建"), button:has-text("Submit"), button:has-text("提交")',
    )
    .first();
  if (await createButton.isVisible().catch(() => false)) {
    const btnText = await createButton.innerText();
    console.log(`点击创建按钮: "${btnText}"`);
    await createButton.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/detailed-04-after-create.png', fullPage: true });
    console.log('✓ 已点击创建按钮');
  }

  console.log('\n步骤 8: 检查是否创建成功');
  await page.waitForTimeout(1000);
  const newContent = await page.locator('body').innerText();
  if (newContent.includes('Test Company')) {
    console.log('✓ 公司创建成功!');
  } else {
    console.log('⚠ 未找到创建的公司的证据');
  }
  await page.screenshot({ path: 'screenshots/detailed-05-current-state.png', fullPage: true });

  console.log('\n步骤 9: 点击创建的公司');
  const companyItem = page.locator('text=Test Company').first();
  if (await companyItem.isVisible().catch(() => false)) {
    await companyItem.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/detailed-06-company-detail.png', fullPage: true });
    console.log('✓ 已进入公司详情页');
  }

  console.log('\n步骤 10: 检查公司详情页元素');
  const detailButtons = await page.locator('button').all();
  console.log(`公司详情页找到 ${detailButtons.length} 个按钮`);

  for (let i = 0; i < Math.min(detailButtons.length, 8); i++) {
    try {
      const btn = detailButtons[i];
      if (await btn.isVisible()) {
        const text = await btn.innerText();
        console.log(`  按钮 ${i + 1}: "${text.substring(0, 50)}"`);
      }
    } catch (e) {}
  }

  console.log('\n步骤 11: 测试面板切换');
  const tabs = await page
    .locator(
      '[role="tab"], button:has-text("Dashboard"), button:has-text("Board"), button:has-text("Editor"), button:has-text("Settings")',
    )
    .all();
  console.log(`找到 ${tabs.length} 个可能的 Tab/面板`);

  for (let i = 0; i < Math.min(tabs.length, 4); i++) {
    try {
      const tab = tabs[i];
      if (await tab.isVisible()) {
        const tabText = await tab.innerText();
        console.log(`点击: "${tabText}"`);
        await tab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `screenshots/detailed-07-tab-${i + 1}.png`, fullPage: true });
      }
    } catch (e) {
      console.log(`Tab ${i + 1} 点击失败: ${e.message}`);
    }
  }

  console.log('\n步骤 12: 测试编辑器/输入区域');
  const editorArea = page
    .locator('textarea, [contenteditable="true"], .editor, .ProseMirror, .monaco-editor')
    .first();
  if (await editorArea.isVisible().catch(() => false)) {
    await editorArea.click();
    await page.keyboard.type('This is a test task: Implement user authentication');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/detailed-08-editor-input.png', fullPage: true });
    console.log('✓ 已在编辑器中输入内容');
  }

  console.log('\n步骤 13: 测试窄屏布局');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/detailed-09-mobile-view.png', fullPage: true });
  console.log('✓ 窄屏截图已保存');

  console.log('\n步骤 14: 测试窄屏下的按钮');
  const mobileMenuBtn = page
    .locator('button[aria-label*="menu" i], button:has-text("☰"), button:has-text("≡")')
    .first();
  if (await mobileMenuBtn.isVisible().catch(() => false)) {
    await mobileMenuBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/detailed-10-mobile-menu.png', fullPage: true });
    console.log('✓ 移动端菜单已打开');
  }

  console.log('\n步骤 15: 测试平板视图');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/detailed-11-tablet-view.png', fullPage: true });
  console.log('✓ 平板截图已保存');

  console.log('\n步骤 16: 检查控制台和网络错误');
  console.log('控制台消息数量:', consoleMessages.length);
  console.log('页面错误数量:', pageErrors.length);
  console.log('网络错误数量:', networkErrors.length);
} catch (error) {
  console.error('\n❌ 测试过程中发生错误:', error.message);
  await page.screenshot({ path: 'screenshots/detailed-error.png', fullPage: true });
  console.log('错误状态截图已保存');
}

console.log('\n=== 测试总结 ===');
console.log('控制台消息:');
consoleMessages.forEach((msg, i) => {
  if (msg.type !== 'debug' || msg.text.includes('error') || msg.text.includes('Error')) {
    console.log(`  ${i + 1}. [${msg.type}] ${msg.text.substring(0, 200)}`);
  }
});

console.log('\n页面错误:');
pageErrors.forEach((err, i) => {
  console.log(`  ${i + 1}. ${err}`);
});

console.log('\n网络错误:');
networkErrors.forEach((err, i) => {
  console.log(`  ${i + 1}. ${err}`);
});

await browser.close();
console.log('\n✓ 测试完成!');
