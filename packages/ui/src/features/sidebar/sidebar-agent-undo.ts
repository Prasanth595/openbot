/** The shortcut belongs to focused sidebar navigation; native editor undo stays native. */
export function shouldRestoreAgent(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.shiftKey ||
    event.altKey ||
    !(event.metaKey || event.ctrlKey) ||
    event.key.toLowerCase() !== "z"
  )
    return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="alertdialog"]',
    )
  )
    return false;
  if (target.ownerDocument.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return false;
  return true;
}
