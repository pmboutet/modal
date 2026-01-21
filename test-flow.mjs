import { chromium } from 'playwright';

const run = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('📍 Step 1: Navigate to admin project page...');
  await page.goto('http://localhost:3000/admin/projects/296f27f8-fd63-41a7-b0ed-815436cedeaf');
  await page.waitForLoadState('networkidle');
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/step1-admin-page.png' });
  console.log('📸 Screenshot: /tmp/step1-admin-page.png');

  console.log('📍 Step 2: Looking for SUPPRIMER-TOUT button...');
  
  // Try multiple selectors for the delete button
  let deleteButton = page.getByRole('button', { name: /supprimer.*tout/i });
  if (!(await deleteButton.isVisible().catch(() => false))) {
    deleteButton = page.locator('button:has-text("SUPPRIMER-TOUT")');
  }
  if (!(await deleteButton.isVisible().catch(() => false))) {
    deleteButton = page.locator('button:has-text("Supprimer tout")');
  }
  if (!(await deleteButton.isVisible().catch(() => false))) {
    deleteButton = page.locator('[data-testid="delete-all"]');
  }
  
  if (await deleteButton.isVisible().catch(() => false)) {
    console.log('🗑️ Found delete button, clicking...');
    await deleteButton.click();
    await page.waitForTimeout(1000);
    
    // Check for confirmation dialog
    const confirmButton = page.getByRole('button', { name: /confirmer|oui|supprimer|delete/i });
    if (await confirmButton.isVisible().catch(() => false)) {
      console.log('✅ Confirming deletion...');
      await confirmButton.click();
    }
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/step2-after-delete.png' });
    console.log('📸 Screenshot: /tmp/step2-after-delete.png');
  } else {
    console.log('⚠️ Delete button not found');
    await page.screenshot({ path: '/tmp/step2-page-state.png', fullPage: true });
    console.log('📸 Full page screenshot: /tmp/step2-page-state.png');
  }

  console.log('📍 Step 3: Navigate to participant page with token...');
  await page.goto('http://localhost:3000/?token=e8dacaefa3213ebd29b67434825b7996');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  
  await page.screenshot({ path: '/tmp/step3-participant-page.png' });
  console.log('📸 Screenshot: /tmp/step3-participant-page.png');

  console.log('📍 Step 4: Choose text mode...');
  let textModeButton = page.getByRole('button', { name: /texte|text/i });
  if (!(await textModeButton.isVisible().catch(() => false))) {
    textModeButton = page.locator('button:has-text("Texte")');
  }
  if (!(await textModeButton.isVisible().catch(() => false))) {
    textModeButton = page.locator('[data-mode="text"]');
  }
  
  if (await textModeButton.isVisible().catch(() => false)) {
    console.log('📝 Found text mode button, clicking...');
    await textModeButton.click();
    await page.waitForTimeout(4000);
    
    await page.screenshot({ path: '/tmp/step4-text-mode.png' });
    console.log('📸 Screenshot: /tmp/step4-text-mode.png');
  } else {
    console.log('⚠️ Text mode button not found (might already be in text mode)');
    await page.screenshot({ path: '/tmp/step4-current-state.png' });
  }

  console.log('📍 Step 5: Check timer value...');
  await page.waitForTimeout(2000);
  
  // Try to find timer
  const timerSelectors = [
    '[class*="timer"]',
    '[class*="Timer"]', 
    '[data-testid*="timer"]',
    '.session-timer',
    'text=/\\d+:\\d+/'
  ];
  
  for (const selector of timerSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        const text = await el.textContent();
        console.log(`⏱️ Timer found (${selector}):`, text);
        break;
      }
    } catch (e) {}
  }
  
  await page.screenshot({ path: '/tmp/step5-timer-check.png' });
  console.log('📸 Screenshot: /tmp/step5-timer-check.png');

  console.log('✅ Test complete! Closing in 3 seconds...');
  await page.waitForTimeout(3000);
  await browser.close();
};

run().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
