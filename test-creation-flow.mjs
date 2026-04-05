import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];
const networkErrors = [];
const networkRequests = [];

page.on('console', (msg) => {
  consoleMessages.push({
    type: msg.type(),
    text: msg.text(),
  });
  if (msg.type() === 'error') {
    console.log('Console Error:', msg.text());
  }
});

page.on('pageerror', (error) => {
  pageErrors.push(error.message);
  console.log('Page Error:', error.message);
});

page.on('response', (response) => {
  const url = response.url();
  const status = response.status();
  networkRequests.push({ status, url });

  if (!response.ok() && status >= 400) {
    networkErrors.push(`${status} ${response.statusText()}: ${url}`);
    console.log(`Network Error: ${status} ${response.statusText()} - ${url}`);
  }
});

page.on('requestfailed', (request) => {
  const error = `${request.failure().errorText}: ${request.url()}`;
  networkErrors.push(error);
  console.log(`Request Failed: ${error}`);
});

try {
  console.log('=== 深入测试: 公司创建流程 ===\n');

  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('步骤 1: 截图初始状态');
  await page.screenshot({ path: 'screenshots/flow-01-initial.png', fullPage: true });

  console.log('步骤 2: 点击 New 按钮');
  const newButton = page.locator('button:has-text("New")').first();
  await newButton.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/flow-02-modal-open.png', fullPage: true });

  console.log('步骤 3: 检查模态框结构');
  const modalDialog = page.locator('[role="dialog"]').first();
  const modalVisible = await modalDialog.isVisible().catch(() => false);
  console.log(`模态框可见: ${modalVisible}`);

  console.log('步骤 4: 查找所有表单输入');
  const allInputs = await page.locator('input').all();
  console.log(`找到 ${allInputs.length} 个 input 元素`);

  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i];
    const inputType = await input.getAttribute('type');
    const inputPlaceholder = await input.getAttribute('placeholder');
    const inputValue = await input.inputValue().catch(() => '');
    const isVisible = await input.isVisible().catch(() => false);
    console.log(
      `  Input ${i + 1}: type=${inputType}, placeholder="${inputPlaceholder}", value="${inputValue}", visible=${isVisible}`,
    );
  }

  console.log('步骤 5: 查找名称输入框并填写');
  const nameInput = page.locator('input[type="text"]').first();
  const nameInputVisible = await nameInput.isVisible().catch(() => false);
  console.log(`名称输入框可见: ${nameInputVisible}`);

  if (nameInputVisible) {
    await nameInput.clear();
    await nameInput.fill('My Test Company');
    const valueAfterFill = await nameInput.inputValue();
    console.log(`填写后值: "${valueAfterFill}"`);
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/flow-03-after-name-fill.png', fullPage: true });

  console.log('步骤 6: 查找所有按钮');
  const allButtons = await page.locator('[role="dialog"] button, .fixed button').all();
  console.log(`在模态框中找到 ${allButtons.length} 个按钮`);

  for (let i = 0; i < allButtons.length; i++) {
    const btn = allButtons[i];
    const isVisible = await btn.isVisible().catch(() => false);
    const isDisabled = await btn.getAttribute('disabled').catch(() => null);
    const btnClass = await btn.getAttribute('class');

    if (isVisible) {
      const text = await btn.innerText().catch(() => '');
      console.log(
        `  按钮 ${i + 1}: text="${text}", disabled=${isDisabled !== null}, class=${btnClass ? btnClass.substring(0, 100) : 'none'}`,
      );
    }
  }

  console.log('步骤 7: 查找并点击创建按钮');
  const createButton = page
    .locator(
      'button:has-text("Create"), button:has-text("创建"), button:has-text("Confirm"), button:has-text("确认")',
    )
    .first();
  const createBtnVisible = await createButton.isVisible().catch(() => false);

  if (createBtnVisible) {
    const createBtnText = await createButton.innerText();
    console.log(`找到创建按钮: "${createBtnText}"`);

    console.log('点击前等待...');
    await page.waitForTimeout(500);

    console.log('点击创建按钮...');
    await createButton.click({ force: true });

    console.log('等待响应...');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'screenshots/flow-04-after-create-click.png', fullPage: true });

    console.log('步骤 8: 检查页面状态');
    const pageText = await page.locator('body').innerText();
    console.log('当前页面文本预览:', pageText.substring(0, 300));

    const hasCompanyName = pageText.includes('My Test Company');
    const hasRAndD = pageText.includes('R&D Company');
    console.log(`包含 "My Test Company": ${hasCompanyName}`);
    console.log(`包含 "R&D Company": ${hasRAndD}`);

    console.log('步骤 9: 检查模态框是否关闭');
    const modalStillVisible = await page
      .locator('[role="dialog"]')
      .first()
      .isVisible()
      .catch(() => false);
    console.log(`模态框仍然可见: ${modalStillVisible}`);

    if (modalStillVisible) {
      console.log('尝试按 ESC 关闭模态框...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'screenshots/flow-05-after-esc.png', fullPage: true });
    }
  } else {
    console.log('未找到创建按钮!');
  }

  console.log('步骤 10: 测试其他区域');
  console.log('查找左侧边栏...');
  const leftSidebar = page.locator('aside, nav, [role="navigation"]').first();
  const sidebarVisible = await leftSidebar.isVisible().catch(() => false);
  console.log(`左侧边栏可见: ${sidebarVisible}`);

  if (sidebarVisible) {
    const sidebarItems = await page
      .locator('aside li, nav li, [role="navigation"] a, [role="navigation"] button')
      .all();
    console.log(`找到 ${sidebarItems.length} 个导航项`);
  }

  console.log('\n步骤 11: 测试预览区域');
  const previewArea = page.locator('text=PREVIEW, text=Preview').first();
  const previewVisible = await previewArea.isVisible().catch(() => false);
  console.log(`预览区域可见: ${previewVisible}`);

  if (previewVisible) {
    await page.screenshot({ path: 'screenshots/flow-06-preview-area.png', fullPage: true });
  }
} catch (error) {
  console.error('\n❌ 测试错误:', error.message);
  console.error(error.stack);
  await page.screenshot({ path: 'screenshots/flow-error.png', fullPage: true });
}

console.log('\n=== 网络请求汇总 ===');
console.log(`总请求数: ${networkRequests.length}`);
networkRequests.forEach((req) => {
  console.log(`  ${req.status} - ${req.url().substring(0, 100)}`);
});

console.log('\n=== 网络错误 ===');
if (networkErrors.length === 0) {
  console.log('无网络错误');
} else {
  networkErrors.forEach((err) => console.log(`  ${err}`));
}

console.log('\n=== 控制台错误 ===');
if (pageErrors.length === 0) {
  console.log('无页面错误');
} else {
  pageErrors.forEach((err) => console.log(`  ${err}`));
}

await browser.close();
console.log('\n✓ 测试完成!');
