# RiverWindow

[Open RiverWindow](https://gqzy999.github.io/riverwindow-genlayer/) · [Current Stable Studionet v2 contract](https://explorer-studio.genlayer.com/address/0xB9C420b1808eb756E4794438247FBa036fa576F2) · [V2 chain evidence](evidence/v2.json)

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

## Finalized example

The [published USGS review window](https://gqzy999.github.io/riverwindow-genlayer/?contract=0x27eBB0834f1c645BB3a1333B09602405d1d54389&key=0xdb29f70fb341141be79ea93c24ee3e8298706852%2Fusgs-july-2025) can be opened without a wallet. Select **Read finalized state** to load the three observations and the reviewer note. The [acceptance record](evidence/studionet.json) contains deployment and transaction hashes plus the state read after each finalized write. Two dedicated Studionet test accounts signed the flow.

The [front-end transaction record](evidence/frontend.json) captures a separate production-bundle run through EIP-1193 discovery, network selection, signing, finality polling, and readback. The DOM runner uses two test signers and real Studionet transactions. A native extension signing run could not start in the test environment. The published site was checked in Chrome for unauthenticated finalized readback.

## Compare two review windows

Choose **Compare published examples** to see the same three approved USGS daily means under two registered thresholds. The 10,000 ft³/s rule triggered a review and was acknowledged. The 12,000 ft³/s rule was met on one day, so it did not trigger review. Both columns read the deployed contract's latest finalized state. [Second-window evidence](evidence/comparison.json)

Open a window and use **Check registration timing** to verify a registration transaction hash. The app checks successful finality, the sender, the contract and all registered values. It compares the RPC submission timestamp with midnight UTC at the start of the first observation date, a conservative cutoff for the supported gauges in the eastern United States. The timestamp describes submission. Registration timing is informational and retrospective windows remain valid. Both comparison examples are retrospective.

## Responsibility trail

The v2 contract retains the owner's wallet as the registration actor and records the separate wallet that initiated consensus evaluation and the reviewer that acknowledged the result. The workbench labels approved observations, identifies consecutive threshold hits, and displays each actor separately. Archive links identify the contract and record key. The browser stores references and receipt links for records opened locally. The outcomes are loaded from finalized chain state.

Legacy examples remain accessible through the archive. The older contract did not expose the evaluation and acknowledgement actors in its record schema. The workbench uses receipt links for independently verifiable historical actions when the published evidence contains them.

For a fresh v2 validation run, provide two authorized Studionet test signers through the environment and run `npm run acceptance:v2`. The runner saves hashes, finality, execution outcomes and readbacks to `.private/v2-run.json` by default. Set `STUDIO_EVIDENCE_PATH` to use a different destination. Signer environment names are `STUDIO_OWNER_KEY` and `STUDIO_REVIEWER_KEY`.

[Current v2 deployment](https://explorer-studio.genlayer.com/address/0xB9C420b1808eb756E4794438247FBa036fa576F2) · [V2 acceptance receipts and readbacks](evidence/v2.json) · [Production bundle transaction evidence](evidence/frontend-v2.json)

The production bundle acceptance used an EIP-1193 test adapter and temporary zero-value Studionet signers. The non-assigned wallet rejection is independently recorded in the contract acceptance evidence. Inconsistent validator responses were exercised with the local contract test host.
