### Fixed

- A long channel keeps working when its history summary comes back too long. OpenBot now asks the lead for a
  shorter summary, and asks once more when the result is still too long. Before, every new assignment in that
  channel failed with "The history summary is invalid" and "The provider could not start this assignment".
