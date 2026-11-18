# RiverWindow

RiverWindow gives field sampling teams a shared way to apply a preselected discharge rule. The window owner fixes the gauge, three consecutive dates, threshold and reviewer wallet. GenLayer validators independently fetch approved USGS daily mean discharge and compare the entire date-ordered vector. If two consecutive readings meet or exceed the threshold, the assigned reviewer can record an acknowledgement.

## Run

Use Node.js 22 and Python 3.

```sh
npm ci
npm test
npm run dev
npm run build
```

The production output is in `dist/`. For GitHub Pages, select GitHub Actions as the source in repository Pages settings. The included workflow builds and deploys the static output.

## Use a review window

1. Connect an injected wallet and switch to Stable Studionet (61999). Use an existing RiverWindow contract address, or deploy the bundled source from the app.
2. Register a window with an open name, a supported gauge, the first of three dates, a whole-number threshold in cubic feet per second, and a distinct reviewer wallet. Keep the contract address and the reference displayed in the app.
3. Select **Evaluate USGS records**. Any wallet may trigger the check. If an approved, unqualified reading is missing or the source gives inconsistent data, the window stays pending and is retryable.
4. If the record requires review, the designated wallet submits a short acknowledgement. Share the contract address and window reference with teammates so they can read the finalized record without connecting their wallets.

The optional `contract` and `key` URL query parameters prefill those two fields. Only public transaction and record data should be entered.

## Contract and operations

`AWAITING_DATA → RULE_NOT_MET` or `AWAITING_DATA → REVIEW_REQUIRED → ACKNOWLEDGED`.

The source is the fixed [USGS daily API](https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily), with parameter 00060 and mean statistic 00003. The contract checks the station, dates, units, approval and uniqueness, then compares whole thousandths of ft³/s across validators. The generation timestamp and ordering of the source response do not affect consensus. A finalized evaluation preserves the exact normalized readings. Corrections to the upstream history require a new window to evaluate again. Registration also permits retrospective windows. A reviewer acknowledgement identifies a wallet and records its note. Field teams remain responsible for their sampling and safety decisions.

After wallet approval the browser displays the submitted hash, waits for FINALIZED consensus and a successful leader execution, and then reads the latest finalized record. The application checks chain ID and requires zero value and zero reported gas price for submissions.

For scripted deployment, supply an authorized test signer in the environment as `RIVERWINDOW_STUDIO_KEY` and run `npm run deploy`. The script prints the transaction hash before polling, checks deployment success and compares chain code with source. To resume an existing hash without submitting again, use `npm run deploy -- 0x…`.

For a reproducible data window, use USGS 01646500 starting 2025-07-01 and a 10,000 ft³/s threshold. USGS returned approved daily mean values of 9,360, 11,200, and 12,400 ft³/s for these dates. Validate against the linked source when running the transaction because upstream data can be revised.
