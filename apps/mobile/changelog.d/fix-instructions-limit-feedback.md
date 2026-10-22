### Fixed

- Agent instructions longer than 2,000 characters no longer get cut silently. Before, a long paste
  dropped the rest of the text with no warning. Now the field keeps all the text, shows a character
  count near the limit, and shows an error when the text is too long. You cannot save until you
  shorten them.
