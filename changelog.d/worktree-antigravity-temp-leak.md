### Fixed

- Gemini no longer fills the disk on Windows. Each start of the Gemini server unpacks about 310 MB
  into the temporary folder, and a start that was stopped or timed out left that copy behind. Now
  each Gemini process on Windows uses its own folder in the OpenBot data folder, and OpenBot removes
  it when the process ends and at each launch. Folders that earlier versions left stay in `%TEMP%`:
  to get the space back, quit OpenBot and delete the `_MEI` folders in `%TEMP%`.
- On Windows, Gemini does not start when the disk has less than 1 GB free, and says so.
- After 3 failed starts in a row, OpenBot stops starting a provider by itself and shows why on the
  provider row. Refresh the providers to try again.
