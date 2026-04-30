# @offisim/ui-core

- Dialogs: import `DialogShell` / `DialogShellClose` from `@offisim/ui-core`. The legacy `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogClose`, and `DialogTrigger` primitive exports are intentionally removed.
- Popovers: import `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, `PopoverArrow`, and `PopoverClose` from `@offisim/ui-core`. `PopoverContent` registers with `modal-stack` as `kind: 'popover'`; do not hand-roll portals, document listeners, or screen-coordinate popover placement in product components.
