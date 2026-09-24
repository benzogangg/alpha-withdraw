# Alpha.art offer withdraw

Unofficial, open-source page that returns SOL locked in old Alpha.art offers to the wallet that made them.
Not affiliated with Alpha.art. The Alpha.art website is gone, but its on-chain program is still live and
still lets the bidder cancel an offer.

## How Alpha.art offers hold your SOL

Every offer is its own 85-byte account owned by the Alpha.art program
`HZaWndaNWHFDd9Dhk5pqUUtsmoBCqzb1MLu3NAh1VX6B`. The offer price sits in that account's balance.

| offset | field |
|---|---|
| 0 | tag (`01`) |
| 1 | bidder (the wallet that made the offer, and where the SOL returns) |
| 33 | NFT mint |
| 65 | price (u64 lamports) |

## What you sign

Only Alpha.art `Cancel Bid` instructions (data `04`), one per offer, up to 10 per transaction.
Accounts: bidder (signer, receives the SOL), offer (closed). That is the whole instruction — no mint,
no token accounts, no third party. The full offer balance goes back to the bidder.
No token approvals, no transfers to anyone else. Network fee is 0.000005 SOL per transaction.

Before your wallet sees a transaction, the page checks that it contains nothing else: every instruction
is an Alpha.art Cancel Bid (data `04`) for an offer whose bidder is your wallet, with your wallet as the
signer and fee payer. Anything else is refused.

## Where the offer list comes from

Public Solana RPCs refuse to search a program's accounts from a browser. `offers.json` is a list of
open offers grouped by bidder, built by `build_index.py`. The page uses it only to know which accounts
to look at. It then re-reads every account on-chain and keeps it only if it is still owned by Alpha.art,
is 85 bytes long, and has your wallet as the bidder. Offers made after the list date are not shown.

To refresh the list:

```
python3 build_index.py
```

## Check it yourself

- Open "Check any address without connecting", paste a wallet: the page lists its offers and simulates
  the withdrawal without signing anything.
- Your wallet (Phantom, Solflare, Backpack) shows its own simulation before you approve.
- `web3.iife.min.js` is `@solana/web3.js` 1.98.0 from npm, unchanged.

## Hyperspace escrow withdraw

Also had bids on **Hyperspace**? A copy of the Hyperspace escrow withdraw page is served from this repository:
**https://benzogangg.github.io/alpha-withdraw/hyperspace/** (code in [`hyperspace/`](hyperspace/)).
It sends the Hyperspace program's own `Withdraw` instruction and moves your escrow balance to your connected wallet.
Full description: https://github.com/benzogangg/hyperspace-withdraw
