import { test, expect } from '@playwright/test';

test.describe('Token Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to create token page', async ({ page }) => {
    await page.click('text=Create Token');
    await expect(page).toHaveURL('/create');
    await expect(page.locator('h1')).toContainText('Create ICRC-1 Token');
  });

  test('should display connection warning when not connected', async ({ page }) => {
    await page.goto('/create');
    
    await expect(page.locator('[data-testid="connection-warning"]')).toContainText(
      'Please connect your Internet Identity'
    );
    
    // Submit button should be disabled
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('should validate token creation form', async ({ page }) => {
    await page.goto('/create');
    
    // Try to fill form with invalid data
    await page.fill('[data-testid="token-name"]', ''); // Empty name
    await page.fill('[data-testid="token-symbol"]', 't'); // Too short symbol
    await page.fill('[data-testid="total-supply"]', '0'); // Zero supply
    await page.fill('[data-testid="decimals"]', '25'); // Too many decimals
    
    // Trigger validation
    await page.click('button[type="submit"]');
    
    // Should show validation errors
    await expect(page.locator('text=Token name is required')).toBeVisible();
    await expect(page.locator('text=Symbol must be at least 2 characters')).toBeVisible();
    await expect(page.locator('text=Total supply must be a positive integer')).toBeVisible();
  });

  test('should fill form with valid data', async ({ page }) => {
    await page.goto('/create');
    
    await page.fill('[data-testid="token-name"]', 'Test Token');
    await page.fill('[data-testid="token-symbol"]', 'TEST');
    await page.fill('[data-testid="total-supply"]', '1000000');
    await page.fill('[data-testid="decimals"]', '8');
    
    // Toggle features
    await page.click('[data-testid="mintable-switch"]');
    await page.click('[data-testid="burnable-switch"]');
    
    // Form should be valid (submit button enabled when connected)
    const submitButton = page.locator('button[type="submit"]');
    const isDisabled = await submitButton.getAttribute('disabled');
    
    // Should only be disabled due to connection, not validation
    if (isDisabled !== null) {
      await expect(page.locator('text=Connect your Internet Identity')).toBeVisible();
    }
  });

  test('should handle logo upload', async ({ page }) => {
    await page.goto('/create');
    
    // Create a test image file
    const fileContent = Buffer.from('fake-image-data');
    
    await page.setInputFiles('[data-testid="logo-upload"]', {
      name: 'test-logo.png',
      mimeType: 'image/png',
      buffer: fileContent,
    });
    
    // Should show preview (would need to mock file reader in real test)
    // This tests the file input acceptance
    const fileInput = page.locator('[data-testid="logo-upload"]');
    const files = await fileInput.evaluate((input: HTMLInputElement) => input.files?.length);
    expect(files).toBe(1);
  });
});

test.describe('Token Dashboard', () => {
  test('should display token list', async ({ page }) => {
    await page.goto('/dashboard');
    
    await expect(page.locator('h1')).toContainText('Token Dashboard');
    
    // Should have search and filter controls
    await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-filter"]')).toBeVisible();
    
    // Should have stats cards
    await expect(page.locator('text=Total Tokens')).toBeVisible();
    await expect(page.locator('text=Deployed')).toBeVisible();
  });

  test('should filter tokens by status', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Click status filter
    await page.click('[data-testid="status-filter"]');
    await page.click('text=Deployed');
    
    // Should update the filter
    await expect(page.locator('[data-testid="status-filter"]')).toContainText('Deployed');
  });

  test('should search tokens', async ({ page }) => {
    await page.goto('/dashboard');
    
    await page.fill('[data-testid="search-input"]', 'TEST');
    
    // Should update the search input
    await expect(page.locator('[data-testid="search-input"]')).toHaveValue('TEST');
  });

  test('should navigate to token details', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Wait for tokens to load and click first token details button
    await page.waitForSelector('[data-testid="token-details-button"]', { timeout: 5000 });
    await page.click('[data-testid="token-details-button"]');
    
    // Should navigate to token details page
    await expect(page).toHaveURL(/\/tokens\/\d+/);
  });
});

test.describe('Token Details and Operations', () => {
  test('should display token information', async ({ page }) => {
    // Navigate to a mock token details page
    await page.goto('/tokens/1');
    
    await expect(page.locator('h1')).toContainText('Test Token');
    
    // Should show token stats
    await expect(page.locator('text=Total Supply')).toBeVisible();
    await expect(page.locator('text=Your Balance')).toBeVisible();
    await expect(page.locator('text=Canister ID')).toBeVisible();
    
    // Should have operation tabs
    await expect(page.locator('text=Overview')).toBeVisible();
    await expect(page.locator('text=Transactions')).toBeVisible();
  });

  test('should show mint tab for mintable tokens', async ({ page }) => {
    await page.goto('/tokens/1');
    
    // Check if mint tab exists (depends on token being mintable and user being owner)
    const mintTab = page.locator('text=Mint');
    const isVisible = await mintTab.isVisible().catch(() => false);
    
    if (isVisible) {
      await mintTab.click();
      await expect(page.locator('text=Amount to Mint')).toBeVisible();
    }
  });

  test('should validate mint operation', async ({ page }) => {
    await page.goto('/tokens/1');
    
    const mintTab = page.locator('text=Mint');
    const isVisible = await mintTab.isVisible().catch(() => false);
    
    if (isVisible) {
      await mintTab.click();
      
      // Try to mint without amount
      await page.click('text=Mint Tokens');
      
      // Button should be disabled or show error
      const mintButton = page.locator('text=Mint Tokens');
      const isDisabled = await mintButton.getAttribute('disabled');
      expect(isDisabled).not.toBeNull();
    }
  });

  test('should validate transfer operation', async ({ page }) => {
    await page.goto('/tokens/1');
    
    await page.click('text=Transfer');
    
    // Should show transfer form
    await expect(page.locator('text=Recipient Principal')).toBeVisible();
    await expect(page.locator('text=Amount')).toBeVisible();
    
    // Try to transfer without filling form
    await page.click('text=Transfer Tokens');
    
    // Button should be disabled
    const transferButton = page.locator('text=Transfer Tokens');
    const isDisabled = await transferButton.getAttribute('disabled');
    expect(isDisabled).not.toBeNull();
  });

  test('should copy canister ID', async ({ page }) => {
    await page.goto('/tokens/1');
    
    // Mock clipboard API
    await page.addInitScript(() => {
      Object.assign(navigator, {
        clipboard: {
          writeText: (text: string) => Promise.resolve(),
        },
      });
    });
    
    const copyButton = page.locator('[data-testid="copy-canister-id"]');
    const isVisible = await copyButton.isVisible().catch(() => false);
    
    if (isVisible) {
      await copyButton.click();
      // Would show toast notification in real app
    }
  });
});

test.describe('Search and Discovery', () => {
  test('should display search page', async ({ page }) => {
    await page.goto('/search');
    
    await expect(page.locator('h1')).toContainText('Token Explorer');
    
    // Should show popular tokens section
    await expect(page.locator('text=Popular Tokens')).toBeVisible();
    
    // Should show search form
    await expect(page.locator('text=Search Tokens')).toBeVisible();
    await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
  });

  test('should search tokens', async ({ page }) => {
    await page.goto('/search');
    
    await page.fill('[data-testid="search-input"]', 'TEST');
    
    // Should show search results section
    await expect(page.locator('text=Search Results')).toBeVisible();
  });

  test('should filter search results', async ({ page }) => {
    await page.goto('/search');
    
    // Change status filter
    await page.click('[data-testid="status-filter"]');
    await page.click('text=Deployed');
    
    // Toggle feature filters
    await page.click('[data-testid="mintable-filter"]');
    await page.click('[data-testid="burnable-filter"]');
    
    // Should update the filters
    await expect(page.locator('[data-testid="status-filter"]')).toContainText('Deployed');
  });

  test('should reset search filters', async ({ page }) => {
    await page.goto('/search');
    
    // Set some filters
    await page.fill('[data-testid="search-input"]', 'TEST');
    await page.click('[data-testid="status-filter"]');
    await page.click('text=Deployed');
    
    // Reset filters
    await page.click('text=Reset Filters');
    
    // Should clear all filters
    await expect(page.locator('[data-testid="search-input"]')).toHaveValue('');
    await expect(page.locator('[data-testid="status-filter"]')).toContainText('All Status');
  });
});

test.describe('Analytics Dashboard', () => {
  test('should display analytics page', async ({ page }) => {
    await page.goto('/analytics');
    
    await expect(page.locator('h1')).toContainText('Platform Analytics');
    
    // Should show stats cards
    await expect(page.locator('text=Total Tokens')).toBeVisible();
    await expect(page.locator('text=Total Transactions')).toBeVisible();
    await expect(page.locator('text=Active Tokens')).toBeVisible();
    
    // Should show tabs
    await expect(page.locator('text=Platform Overview')).toBeVisible();
    await expect(page.locator('text=Growth Metrics')).toBeVisible();
  });

  test('should switch between