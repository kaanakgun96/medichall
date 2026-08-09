# Rollback manifest

Baseline captured from the public production URLs on 2026-08-09 before this release was packaged. All listed responses were HTTP 200. The old HTML consistently used asset version `20260808s21rc1`.

| File | Bytes | SHA-256 |
|---|---:|---|
| `admin.html` | 58,448 | `bd3ee92c88dcba96453efccb9e14933fc6aaa46a468870c992365f3d9c0a368b` |
| `companies.html` | 59,235 | `147777d07426d358c8dc676a568df930f31e5d3621b78a67003c245b2af65a63` |
| `index.html` | 105,072 | `e101a81c7c3b8b4f02490aee415f6741c74510df221c358bc0af1f67e9ae694f` |
| `marketplace-companies.js` | 15,162 | `bbd9574eede03a6b9a7445d5f95e271d1deeb3c021d34dcfe550d1a1d8930e20` |
| `marketplace-domain.js` | 15,531 | `c796059b822acc321986fbdabc7adafbd19d900be53d2f8c80ed5a130794dde8` |
| `marketplace-enterprise.css` | 14,551 | `41b9c919d97ff6cfba0fbe59ac8d8e0710d48ad2f6228c8373ba8ca431ebe709` |
| `marketplace-products.js` | 41,271 | `64e8c1e18a1afab921db4a3bdec27879c7d111c3981232ef1ddac3f8b594801f` |
| `matchmaking-domain.js` | 11,229 | `28d60beaa59ebbc9cbc9ec8fb76113c5059bf3952db434424a53acee9dc47501` |
| `matchmaking-workspace.js` | 65,383 | `98aa1b460da0e45806fb379e5a98208a7d16bbb2760345670d685610cc8e5381` |
| `matchmaking.html` | 20,935 | `d6dd88806e2a8d903406bfa08e37c4402ff12562f647458eaf4d8bf12541666b` |
| `medichall-design-system.css` | 28,219 | `4cc3c8413d3e1faf7a83f25f6f70926d5641b7be2783a17af6d071e6753864ff` |
| `medichall-navigation.js` | 26,553 | `1852641f55e850c3e40fab6b9a7949def3d160719b4d200d7a64e54e5c69c75b` |
| `medichall-session.js` | 7,531 | `1e60bdce3d2caff5953e6b72516786b350a395a719f05bfa80c5aa1a97806620` |
| `portal.html` | 334,358 | `0c418fdcd5de2f544d93b949749246b038d49e8ab7fd5c20ef188ce06532c4aa` |
| `products.html` | 65,744 | `1efd4e39c70b4adfeb02ca406465c8a9a2135a70b034cdca2e829b68acb2bd87` |
| `tenders.html` | 13,404 | `99c5a35018148170a7a4d5346ce6bb1a871ebb72bbd7635165cd8d79798c1c8e` |
| `tenders.js` | 17,166 | `e46efc80a0ba14c2fc64c940c064abaa407a0d75ea647439feb69afa4cc28255` |

`medichall-ui.js` is intentionally absent from `ROLLBACK_BASELINE`: production returned HTTP 404 for it at capture time. Remove that one new file only after restoring the baseline pages.
