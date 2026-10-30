/**
 * End-to-end test: registers a passkey (virtual authenticator), derives the
 * address, reads the balance, verifies the fee estimate + fee-aware Max
 * button, then attempts a transfer — expecting the node to reject only on
 * funds (proving the browser WebAuthn signing pipeline produces a valid
 * Tempo type-0x76 transaction) and the UI to surface clear feedback.
 *
 * Run: `npm run e2e`
 */
import { chromium } from '@playwright/test'

const BASE = process.env.WALLET_URL ?? 'http://localhost:5173'

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })

  console.log('→ visiting', BASE)
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // 1. Register a passkey with an email (mixed case + padding → normalized)
  console.log('→ registering passkey…')
  // invalid email first → should be rejected
  await page.fill('#email', 'not-an-email')
  await page.click('button:has-text("Create new passkey wallet")')
  await page.waitForSelector('.error', { timeout: 10_000 })
  const invalidErr = (await page.textContent('.error'))?.trim()
  console.log('→ invalid email rejected:', invalidErr?.slice(0, 60))
  if (!/valid email/i.test(invalidErr ?? '')) {
    console.log('✘ expected email validation error')
    await browser.close()
    process.exit(1)
  }

  // valid email with padding + uppercase → normalized to lowercase/trimmed
  await page.fill('#email', '  Test.User@Example.COM  ')
  await page.click('button:has-text("Create new passkey wallet")')
  await page.waitForSelector('text=Balance', { timeout: 20_000 })
  const accountName = (await page.textContent('.account-head h2'))?.trim()
  console.log('→ account name:', accountName)
  if (accountName !== 'test.user@example.com') {
    console.log('✘ expected normalized email test.user@example.com, got:', accountName)
    await browser.close()
    process.exit(1)
  }
  console.log('✔ registered & email normalized')

  // Creating a second account with the SAME email must be blocked
  console.log('→ same-email second account must be blocked…')
  await page.click('button:has-text("Disconnect")')
  await page.waitForSelector('.existing', { timeout: 10_000 })
  await page.fill('#email', 'test.user@example.com')
  await page.click('button:has-text("Create new passkey wallet")')
  await page.waitForSelector('.error', { timeout: 10_000 })
  const dupErr = (await page.textContent('.error'))?.trim()
  if (!/already have a passkey/i.test(dupErr ?? '')) {
    console.log('✘ expected same-email warning, got:', dupErr?.slice(0, 80))
    await browser.close()
    process.exit(1)
  }
  console.log('✔ same-email duplicate blocked with a clear warning')
  // the sign-in list should show the address + created date
  const listLabel = (await page.textContent('.existing-label'))?.trim()
  const listMeta = (await page.textContent('.existing-meta'))?.trim()
  console.log('→ sign-in list shows:', listLabel, '·', listMeta)
  if (!/0x/.test(listMeta ?? '')) {
    console.log('✘ expected an address preview in the sign-in list')
    await browser.close()
    process.exit(1)
  }
  // sign back in with the existing passkey
  await page.click('.existing-row')
  await page.waitForSelector('.balance-amount', { timeout: 20_000 })

  const address = (await page.textContent('code.address'))?.trim()
  console.log('→ address:', address)

  // 2. Enter a recipient → fee estimate should appear
  await page.fill('#to', '0x1234567890abcdef1234567890abcdef12345678')
  await page.waitForSelector('.fee-line .fee-amt', { timeout: 20_000 })
  const feeText = (await page.textContent('.fee-line'))?.trim()
  console.log('→ fee estimate shown:', feeText?.replace(/\s+/g, ' '))
  if (!/Estimated fee/.test(feeText ?? '')) {
    console.log('✘ fee estimate missing')
    await browser.close()
    process.exit(1)
  }

  // 3. Balance is zero → Max should warn, not silently under-fill
  const balanceText = (await page.textContent('.balance-amount')) ?? ''
  console.log('→ balance:', balanceText.trim())
  await page.click('button:has-text("Max")')
  const maxNotice = (await page.textContent('.error'))?.trim()
  console.log('→ Max notice:', maxNotice)
  if (!/too low|cover/i.test(maxNotice ?? '')) {
    console.log('✘ expected a low-balance notice from Max')
    await browser.close()
    process.exit(1)
  }

  // 4. Attempt a transfer (expect graceful insufficient-funds error)
  console.log('→ attempting transfer…')
  await page.fill('#amount', '1.00')
  await page.click('.send-btn')
  await page.waitForSelector('.error', { timeout: 30_000 })
  const err = (await page.textContent('.error'))?.trim()
  console.log('→ send feedback:', err)
  if (!/Insufficient pathUSD/i.test(err ?? '')) {
    console.log('✘ expected an insufficient-funds error, got:', err)
    await browser.close()
    process.exit(1)
  }

  // 4. Activity: empty state should guide the user, and items must render
  console.log('→ checking activity…')
  await page.waitForSelector('.activity-card', { timeout: 10_000 })
  await page.waitForTimeout(2500) // let the initial refresh settle
  const emptyText = (await page.textContent('.activity-card'))?.replace(/\s+/g, ' ')
  if (!/No activity yet/.test(emptyText ?? '')) {
    console.log('✘ expected guided empty state, got:', emptyText?.slice(0, 80))
    await browser.close()
    process.exit(1)
  }
  console.log('✔ empty state shows receive guidance')

  // Intercept the explorer API → feed fake transactions for this address
  await page.route('**/api/v1/addresses/*/txs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            hash: '0x' + 'a1'.repeat(32),
            status: 1,
            timestamp: 1786104000,
            from_addr: '0x' + '11'.repeat(20),
            to_addr: address,
            fee_amount: '168274800000000',
          },
          {
            hash: '0x' + 'b2'.repeat(32),
            status: 1,
            timestamp: 1786107600,
            from_addr: address,
            to_addr: '0x' + '22'.repeat(20),
            fee_amount: '168274800000000',
          },
        ],
        next_page: null,
      }),
    })
  })
  await page.click('button:has-text("Refresh")')
  await page.waitForSelector('.activity li', { timeout: 10_000 })
  const rows = await page.locator('.activity li').count()
  if (rows !== 2) {
    console.log('✘ expected 2 activity rows, got', rows)
    await browser.close()
    process.exit(1)
  }
  const firstDir = await page.locator('.activity li .dir').first().getAttribute('class')
  if (!firstDir?.includes('in')) {
    console.log('✘ expected incoming indicator on the first row')
    await browser.close()
    process.exit(1)
  }
  console.log('✔ activity renders incoming/outgoing rows')
  await page.unroute('**/api/v2/addresses/*/transactions')

  // 5. Sign back in — email should be listed & restored
  console.log('→ signing back in…')
  await page.click('button:has-text("Disconnect")')
  await page.waitForSelector('.existing', { timeout: 10_000 })
  const listedEmail = (await page.textContent('.existing-label'))?.trim()
  if (listedEmail !== 'test.user@example.com') {
    console.log('✘ expected normalized email in sign-in list, got:', listedEmail)
    await browser.close()
    process.exit(1)
  }
  await page.click('.existing-row')
  await page.waitForSelector('.balance-amount', { timeout: 20_000 })
  const addr2 = (await page.textContent('code.address'))?.trim()
  const name2 = (await page.textContent('.account-head h2'))?.trim()
  if (addr2 !== address) {
    console.log('✘ address mismatch after re-login:', addr2, 'vs', address)
    await browser.close()
    process.exit(1)
  }
  if (name2 !== 'test.user@example.com') {
    console.log('✘ account name not restored:', name2)
    await browser.close()
    process.exit(1)
  }
  console.log('✔ re-login restored the same address + email')

  // 6. Cross-device: wipe local data → recover the account from the passkey alone
  console.log('→ simulating a new device (clearing local data)…')
  await page.evaluate(() => localStorage.clear())
  await page.click('button:has-text("Disconnect")')
  await page.waitForSelector('.hero h1', { timeout: 10_000 })
  const hasSignInList = await page.locator('text=Sign back in').count()
  if (hasSignInList > 0) {
    console.log('✘ expected an empty sign-in list after clearing local data')
    await browser.close()
    process.exit(1)
  }
  await page.click('button:has-text("Sign in with a passkey on this device")')
  await page.waitForSelector('.balance-amount', { timeout: 30_000 })
  const addr3 = (await page.textContent('code.address'))?.trim()
  const name3 = (await page.textContent('.account-head h2'))?.trim()
  if (addr3 !== address) {
    console.log('✘ cross-device recovery mismatch:', addr3, 'vs', address)
    await browser.close()
    process.exit(1)
  }
  if (name3 !== 'test.user@example.com') {
    console.log('✘ recovered account name mismatch:', name3)
    await browser.close()
    process.exit(1)
  }
  console.log('✔ passkey-only recovery restored the same address + email')

  console.log('\n✔ E2E PASS — registration, derivation, fee estimate, Max,')
  console.log('  send feedback, re-login and cross-device recovery all work.')
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('E2E failed:', e)
  process.exit(1)
})
