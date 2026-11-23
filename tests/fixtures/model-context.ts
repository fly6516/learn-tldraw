import { expect, type Page } from '@playwright/test'

export const contextReview = (page: Page) => page.getByRole('dialog', { name: 'Review model context' })

export async function approveContext(page: Page) {
  await contextReview(page).getByRole('button', { name: 'Send reviewed request' }).click()
}

export async function approveContextIfRequested(page: Page) {
  const approve = contextReview(page).getByRole('button', { name: 'Send reviewed request' })
  await expect(approve.or(page.getByRole('button', { name: 'Stop', exact: true })).first()).toBeVisible()
  if (await approve.isVisible()) await approve.click()
}
