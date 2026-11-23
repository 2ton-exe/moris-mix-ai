# Desktop critique screenshots

The **before** images come from the supplied `critique-morus` capture of PR #266. The **after** images are Chromium renders of this branch at 1440 × 900. After captures use the real React routes with fixture responses and synthetic authentication; they do not demonstrate live staging AI service availability.

| Route | Before | After |
| --- | --- | --- |
| Recipes | [Before](screenshots/before-recipes.webp) | [After](screenshots/after-recipes.webp) |
| AI Chef | [Before](screenshots/before-chef.webp) | [After](screenshots/after-chef.webp) |
| Quick AI Entry | [Before](screenshots/before-quick-entry.webp) | [After](screenshots/after-quick-entry.webp) |
| Home | [Before](screenshots/before-home.webp) | [After](screenshots/after-home.webp) |
| Login | [Before](screenshots/before-login.webp) | [After](screenshots/after-login.webp) |

Additional after captures: [recipe reading](screenshots/after-detail.webp), [new recipe](screenshots/after-create.webp), [ingredient editing](screenshots/after-ingredient-edit.webp), [extracted recipe review](screenshots/after-quick-review.webp), [compact Mori](screenshots/after-mori-compact.webp), and [About](screenshots/after-about.webp).

The scripts that generated the after captures are `frontend/e2e/journal-visual-fidelity.browser.mjs`, `frontend/e2e/recipe-forms.browser.mjs`, `frontend/e2e/quick-ai-entry.browser.mjs`, and `frontend/e2e/mori-dialogue.browser.mjs`.
