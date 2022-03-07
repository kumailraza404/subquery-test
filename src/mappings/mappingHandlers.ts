import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Account } from '../types/models/Account';
import { tokens } from '../helpers/token'
import { Codec } from "@polkadot/types/types";

type Metadata = {
    from: Codec,
    to: Codec,
    amount: Codec,
    currencyId: { token: string } | undefined
}

async function ensureAccounts(accountIds: string[]): Promise<void> {
    for (const accountId of accountIds) {
        const account = await Account.get(accountId);
        if (!account) {
            await new Account(accountId).save();
        }
    }
}

function getDataFromEvent(event: SubstrateEvent) {
    return event.event.data
}


function calculateFees(extrinsic: SubstrateExtrinsic): bigint {
    const eventRecord = extrinsic.events.find((event) => {
        return event.event.method == "Withdraw" && event.event.section == "balances"
    })

    if (eventRecord) {
        const {
            event: {
                data: [accountid, fee]
            }
        } = eventRecord

        const extrinsicSigner = extrinsic.extrinsic.signer.toString()
        const withdrawAccountId = accountid.toString()

        return extrinsicSigner === withdrawAccountId ? (fee as Balance).toBigInt() : BigInt(0)
    }

    return BigInt(0)
}

export async function handleTransferCurrency(event: SubstrateEvent): Promise<void> {
    const [currencyId, from, to, amount] = getDataFromEvent(event)
    const currency = JSON.parse(JSON.stringify(currencyId))
    if(currency.token){
        await ensureAccounts([from.toString(), to.toString()]);
        
        const transferInfo = processData({ currencyId: currency, event, amount, from, to })
        await transferInfo.save();
    }
}


export async function handleTransfer(event: SubstrateEvent): Promise<void> {
    const [from, to, amount] = getDataFromEvent(event)

    await ensureAccounts([from.toString(), to.toString()]);

    const transferInfo = processData({ currencyId: undefined, event, amount, from, to })
    await transferInfo.save();

}

function processData({ currencyId, event, amount, from, to }) {
    const { KARURA: {
        name, decimals
    } } = tokens
    const currency = currencyId ? currencyId.token : name
    const blockNo = event.block.block.header.number.toNumber();
    const expendedDecimals = BigInt("1" + "0".repeat(decimals))
    const transformedAmount = (amount as Balance).toBigInt();
    const extrinsicHash = event.extrinsic?.extrinsic.hash.toString();
    const timestamp = event.block.timestamp;
    const transferInfo = new Transfer(`${blockNo}-${event.idx}`);
    const isSuccess = event.extrinsic ? event.extrinsic.success : true;


    transferInfo.token = currency;
    transferInfo.fromId = from.toString();
    transferInfo.toId = to.toString();
    transferInfo.timestamp = timestamp;
    transferInfo.extrinsicHash = extrinsicHash;
    transferInfo.amount = transformedAmount;
    transferInfo.fees = event.extrinsic ? calculateFees(event.extrinsic) : BigInt(0)
    transferInfo.status = isSuccess;
    transferInfo.decimals = expendedDecimals;
    return transferInfo
}