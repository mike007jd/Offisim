# Security Policy

## Supported Versions

Security fixes are targeted at the latest release candidate on `main` and the
latest tagged stable release, once stable releases begin.

## Reporting A Vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Report vulnerabilities privately by:

- Opening a GitHub Security Advisory if you have repository access
- Or emailing the maintainers listed on the repository profile

Include:

- A clear description of the issue
- Affected versions or commit SHAs
- Reproduction steps or proof of concept
- Impact assessment
- Suggested mitigation, if known

## Response Expectations

- Initial acknowledgement: within 5 business days
- Triage and reproduction: as soon as practical
- Fix and coordinated disclosure: depends on severity and exploitability

We will make a best effort to keep reporters informed throughout the process.

## Scope Notes

For Offisim 1.0, the highest-priority reports are:

- Remote code execution
- Auth or privilege escalation issues in `apps/platform`
- Secret exposure
- Install or package trust bypasses
- Unsafe tool execution or approval bypasses
- Data exfiltration from the local-first runtime
