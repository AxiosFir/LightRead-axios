/** User-facing selection / confirmation helpers for application-owned panels. */
export async function chooseOption(page, trigger, value) {
  await trigger.click()
  await page.locator(`.app-select-option[data-value=${JSON.stringify(String(value))}]`).click()
}
export const acceptConfirmation = page => page.locator('.confirm-accept').click()
