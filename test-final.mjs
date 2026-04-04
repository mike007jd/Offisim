import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];
const networkErrors = [];

page.on('console', msg => {
  consoleMessages.push({
    type: msg.type(),
    text: msg.text()
  });
  if (msg.type() === 'error') {
    console.log('Console Error:', msg.text());
  }
});

page.on('pageerror', error => {
  pageErrors.push(error.message);
  console.log('Page Error:', error.message);
});

page.on('response', response => {
  const url = response.url();
  const status = response.status();
  if (!response.ok() && status >= 400) {
    networkErrors.push(`${status} ${response.statusText()}: ${url}`);
    console.log(`Network Error: ${status} ${response.statusText()} - ${url}`);
  }
});

page.on('requestfailed', request => {
  const error = `${request.failure().errorText}: ${request.url()}`;
  networkErrors.push(error);
  console.log(`Request Failed: ${error}`);
});

try {
  console.log('=== 完整测试: AI Company Simulator ===\n');
  
  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  console.log('【测试 1】首屏加载');
  await page.screenshot({ path: 'screenshots/final-01-homepage.png', fullPage: true });
  const pageTitle = await page.title();
  console.log(`✓ 页面标题: ${pageTitle}`);
  
  console.log('\n【测试 2】点击 "New" 打开模态框');
  const newButton = page.locator('button:has-text("New")').first();
  await newButton.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/final-02-new-modal.png', fullPage: true });
  console.log('✓ 模态框已打开');
  
  console.log('\n【测试 3】查找并点击 "Start Company" 按钮');
  const startButton = page.locator('button:has-text("Start Company")');
  const startBtnExists = await startButton.count() > 0;
  
  if (startBtnExists) {
    console.log('找到 "Start Company" 按钮');
    await startButton.click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/final-03-after-start.png', fullPage: true });
    
    console.log('检查是否成功进入公司...');
    const bodyText = await page.locator('body').innerText();
    console.log('当前页面内容预览:', bodyText.substring(0, 400));
    
    const modalClosed = !(await page.locator('[role="dialog"]').first().isVisible().catch(() => false));
    console.log(`✓ 模态框已关闭: ${modalClosed}`);
  } else {
    console.log('❌ 未找到 "Start Company" 按钮');
  }
  
  console.log('\n【测试 4】检查公司列表');
  const companyList = page.locator('text=COMPANIES');
  const companyListVisible = await companyList.isVisible().catch(() => false);
  console.log(`公司列表区域可见: ${companyListVisible}`);
  
  const companies = await page.locator('li, [role="listitem"], article, .company').all();
  console.log(`找到 ${companies.length} 个公司项`);
  
  await page.screenshot({ path: 'screenshots/final-04-company-list.png', fullPage: true });
  
  console.log('\n【测试 5】测试 Tab 切换');
  const tabButtons = await page.locator('[role="tab"], button:has-text("Dashboard"), button:has-text("Board"), button:has-text("Editor"), button:has-text("Settings"), button:has-text("Portal"), button:has-text("Workspace")').all();
  console.log(`找到 ${tabButtons.length} 个可能的 Tab`);
  
  for (let i = 0; i < Math.min(tabButtons.length, 3); i++) {
    try {
      const tab = tabButtons[i];
      if (await tab.isVisible()) {
        const tabText = await tab.innerText();
        console.log(`点击 Tab: "${tabText.substring(0, 30)}"`);
        await tab.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `screenshots/final-05-tab-${i + 1}.png`, fullPage: true });
      }
    } catch (e) {
      console.log(`Tab ${i + 1} 点击失败: ${e.message}`);
    }
  }
  
  console.log('\n【测试 6】测试侧边栏');
  const sidebarButtons = await page.locator('aside button, nav button, [role="navigation"] button').all();
  console.log(`找到 ${sidebarButtons.length} 个侧边栏按钮`);
  
  for (let i = 0; i < Math.min(sidebarButtons.length, 3); i++) {
    try {
      const btn = sidebarButtons[i];
      if (await btn.isVisible()) {
        const btnText = await btn.innerText();
        console.log(`点击侧边栏按钮: "${btnText.substring(0, 30)}"`);
        await btn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `screenshots/final-06-sidebar-${i + 1}.png`, fullPage: true });
      }
    } catch (e) {}
  }
  
  console.log('\n【测试 7】测试响应式 - 窄屏');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/final-07-mobile.png', fullPage: true });
  console.log('✓ 窄屏截图已保存');
  
  console.log('\n【测试 8】测试响应式 - 平板');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/final-08-tablet.png', fullPage: true });
  console.log('✓ 平板截图已保存');
  
  console.log('\n【测试 9】测试响应式 - 桌面');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/final-09-desktop.png', fullPage: true });
  console.log('✓ 桌面截图已保存');
  
  console.log('\n【测试 10】查找并测试编辑区域');
  const editorSelectors = [
    'textarea',
    '[contenteditable="true"]',
    '.editor',
    '.ProseMirror',
    '.monaco-editor',
    '[role="textbox"]',
    '.DraftEditor-root',
    '.ck-editor'
  ];
  
  for (const selector of editorSelectors) {
    const editor = page.locator(selector).first();
    if (await editor.isVisible().catch(() => false)) {
      console.log(`找到编辑器: ${selector}`);
      await editor.click();
      await page.keyboard.type('Test task: Design user interface');
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'screenshots/final-10-editor-input.png', fullPage: true });
      console.log('✓ 已在编辑器中输入内容');
      break;
    }
  }
  
  console.log('\n【测试 11】测试拖放/交互');
  const draggableElements = await page.locator('[draggable="true"], .draggable, .sortable-item').all();
  console.log(`找到 ${draggableElements.length} 个可拖拽元素`);
  
  console.log('\n【测试 12】测试下拉菜单/选择器');
  const dropdowns = await page.locator('select, [role="combobox"], [role="listbox"]').all();
  console.log(`找到 ${dropdowns.length} 个下拉菜单`);
  
  console.log('\n【测试 13】测试模态框/Dialog');
  const dialogs = await page.locator('[role="dialog"], [role="alertdialog"], .modal, .dialog').all();
  console.log(`找到 ${dialogs.length} 个对话框`);
  
  console.log('\n【测试 14】测试工具提示/Tooltip');
  const tooltips = await page.locator('[data-tooltip], [title], [aria-label]').all();
  console.log(`找到 ${tooltips.length} 个可能有提示的元素`);
  
  console.log('\n【测试 15】测试表单验证');
  const forms = await page.locator('form').all();
  console.log(`找到 ${forms.length} 个表单`);
  
  console.log('\n【测试 16】检查控制台错误');
  console.log(`控制台消息: ${consoleMessages.length}`);
  console.log(`页面错误: ${pageErrors.length}`);
  console.log(`网络错误: ${networkErrors.length}`);
  
} catch (error) {
  console.error('\n❌ 测试错误:', error.message);
  console.error(error.stack);
  await page.screenshot({ path: 'screenshots/final-error.png', fullPage: true });
}

console.log('\n=== 错误汇总 ===');
if (pageErrors.length > 0) {
  console.log('页面错误:');
  pageErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
}

if (networkErrors.length > 0) {
  console.log('网络错误:');
  networkErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
}

await browser.close();
console.log('\n✓ 所有测试完成!');
