# Shortcut Planning (Chrome on Windows)

![Available shortcut combinations on a keyboard](shortcut-keyboard.png)

The keyboard image reserves three fixed modifier lines and three corresponding action lines per key. `[Action name]` is a placeholder, not a suggested or assigned command; unavailable combinations leave both matching lines blank. Keys with no available combination are dimmed.

This table records the owner's current recommendations. The options page shows them only when that exact combination is not assigned. It does not assign keys in `project/manifest.json` or in Chrome. Existing Chrome assignments stay in place when command IDs do; a reordered action whose internal command ID changed needs reassignment. `—` in **Suggested Action** means no recommendation yet; **Not use** marks a combination the owner has excluded from consideration. Other Chrome versions, websites, Windows utilities, and installed extensions can also claim keys, so verify a chosen shortcut in `chrome://extensions/shortcuts` on the target setup.

Options flags any assigned combination outside the unstruck combinations below as discouraged: its grid modifier is pale red and the action row shows a red warning. An assigned unstruck combination that differs from that action's suggestion shows a yellow warning. Both cases keep the suggested shortcut visible at the left of the assigned keys. Only the warning icon has a hover explanation; the suggested string itself has no tooltip. These indicators never change the actual Chrome assignment.

After the current recommendations, the considered unused Ctrl+Shift combinations are E and F. Ctrl+Shift+R remains excluded because Chrome uses it for a hard reload.

Chrome action descriptions below are based on [Chrome's Windows shortcut list](https://support.google.com/chrome/answer/157179?hl=en), [Chromium's accelerator mappings](https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/chrome/browser/ui/accelerator_table.cc), and [DevTools shortcuts](https://developer.chrome.com/docs/devtools/shortcuts). Tab-group commands may have no visible effect when their context is absent. The owner may use some combinations that Chrome also maps; only the struck-through combinations below are currently excluded by owner choice.

## Alt

| Key | Chrome action | Suggested Action |
| --- | --- | --- |
| 1 | None identified on Windows | Copiar ID |
| 2 | None identified on Windows | Copiar Nome |
| 3 | None identified on Windows | Copiar Email |
| 4 | None identified on Windows | Copiar Doc. |
| 5 | None identified on Windows | Copiar Emails Censurados / Atribuir BO |
| 6 | None identified on Windows | Copiar Nome Produtor |

## Alt + Shift

| Key | Chrome action | Suggested Action |
| --- | --- | --- |
| 1 | None identified | Pesquisar Contas Orbita |
| 2 | None identified | Pesquisar Contas Nutror |
| 3 | None identified | Pesquisar Faturas |
| 4 | None identified | Pesquisar Contratos |
| 5 | None identified | Verificar Bounce |
| Q | None identified | Definir Fatura / Copiar Fatura |
| W | Close tab group, where supported | Abrir Próximo Ticket |
| E | None identified | Definir Valor / Copiar Valor |
| ~~R~~ | ~~Reading mode~~ | Not use |
| ~~T~~ | ~~Focus toolbar~~ | Not use |
| A | Focus inactive dialog | Abrir Detalhes Fatura |
| S | None identified | Abrir Detalhes Conteúdo |
| D | None identified | Copiar Dados Fatura |
| F | None identified | Copiar Email Suporte |
| G | None identified | Copiar Nome Produto |
| ~~Z~~ | ~~Previous tab group, where supported~~ | Not use |
| X | Next tab group, where supported | Selecionar Fatura 1 |
| C | Add tab to group, where supported | Selecionar Fatura 2 |
| V | None identified | Selecionar Fatura 3 |
| B | Focus bookmarks bar | Selecionar Fatura 4 |

## Ctrl + Shift

| Key | Chrome action | Suggested Action |
| --- | --- | --- |
| Q | None identified on Windows | Limpar Fatura Definida |
| ~~W~~ | ~~Close window~~ | Not use |
| E | None identified | Limpar Valor Definido |
| ~~R~~ | ~~Hard reload~~ | Not use |
| ~~A~~ | ~~Tab search~~ | Not use |
| S | None identified | Realizar Entrega Manual |
| ~~D~~ | ~~Bookmark all tabs~~ | Not use |
| F | Search in DevTools when focused | Baixar Comprovante Reembolso |
| ~~Z~~ | ~~Redo in many text editors~~ | Not use |
| X | None identified | Ativar / Desativar TicketHelper |
| ~~C~~ | ~~Inspect element~~ | Not use |
| ~~V~~ | ~~Paste without formatting~~ | Not use |
