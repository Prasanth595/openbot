### Fixed

- When an OpenCode model needs a sign-in that its provider does not have, the chat no longer shows
  only "Authentication required: provider authentication required". The error names the provider
  and tells you what to do: choose a model with the Free label, paste an OpenCode Go key in the
  OpenCode settings, or run `opencode auth login` in a terminal. The README says which OpenCode
  models need no sign-in.
