### Security

- Remove more types of secrets from logs, diagnostics and exports: JSON Web Tokens, private keys,
  every cookie in a cookie header, credential values in web addresses, and Google, GitLab, npm,
  Hugging Face, Groq, AWS session and Stripe keys. Before, a secret of these types from a provider
  message could stay in a log.
