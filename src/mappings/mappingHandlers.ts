import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Account } from '../types/models/Account';
import { tokens } from '../helpers/token'
import { Codec } from "@polkadot/types/types";

type MetadataEvent = {
    from: Codec,
    to: Codec,
    amount: Codec,
    event: SubstrateEvent,
    currencyId: { token: string } | undefined
}

type MetadataExtrinsic = {
    from: Codec,
    to: Codec,
    amount: Codec,
    extrinsic: SubstrateExtrinsic,
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
    let depositFees = BigInt(0);
    let treasuryFees = BigInt(0);

    const eventRecordWithdraw = extrinsic.events.find((event) => {
        return event.event.method == "Withdraw" && event.event.section == "balances"
    })

    // logger.info('records -->' + eventRecordWithdraw)
    if (eventRecordWithdraw) {
        const {
            event: {
                data: [accountid, fee]
            }
        } = eventRecordWithdraw

        const extrinsicSigner = extrinsic.extrinsic.signer.toString()
        const withdrawAccountId = accountid.toString()

        return extrinsicSigner === withdrawAccountId ? (fee as Balance).toBigInt() : BigInt(0)
    }

    const eventRecordDeposit = extrinsic.events.find((event) => {
        return event.event.method == "Deposit" && event.event.section == "balances"
    })

    const eventRecordTreasury = extrinsic.events.find((event) => {
        return event.event.method == "Deposit" && event.event.section == "treasury"
    })

    if (eventRecordDeposit) {
        const { event: { data: [, fee] } } = eventRecordDeposit

        depositFees = (fee as Balance).toBigInt()
    }
    if (eventRecordTreasury) {
        const { event: { data: [fee] } } = eventRecordTreasury

        treasuryFees = (fee as Balance).toBigInt()
    }

    const totalFees = depositFees + treasuryFees

    return totalFees
}

export async function handleTransferCurrency(event: SubstrateEvent): Promise<void> {
    const [currencyId, from, to, amount] = getDataFromEvent(event)
    const currency = JSON.parse(JSON.stringify(currencyId))
    if (currency.token) {
        await ensureAccounts([from.toString(), to.toString()]);

        const transferInfo = processDataSuccess({ currencyId: currency, event, amount, from, to })
        await transferInfo.save();
    }
}


export async function handleTransfer(event: SubstrateEvent): Promise<void> {
    const [from, to, amount] = getDataFromEvent(event)

    await ensureAccounts([from.toString(), to.toString()]);

    const transferInfo = processDataSuccess({ currencyId: undefined, event, amount, from, to })
    await transferInfo.save();

}

export async function handleFailedTransfers(extrinsic: SubstrateExtrinsic): Promise<void> {
    const { isSigned } = extrinsic.extrinsic;

    if (isSigned) {
        if (extrinsic.success) {
            return null
        }

        const method = extrinsic.extrinsic.method;
        const events = ["transfer", "transferKeepAlive"]



        if (method.section == "balances" && events.includes(method.method)) {
            const [to, amount] = method.args;
            const from = extrinsic.extrinsic.signer;
            await ensureAccounts([from.toString(), to.toString()]);

            const transferInfo = processDataFail({ currencyId: undefined, extrinsic, amount, from, to })
            await transferInfo.save();
        }
        else if (method.section == "currencies" && events.includes(method.method)) {
            const [dest, currencyId, amount] = method.args;
            const { id: to } = JSON.parse(JSON.stringify(dest));
            const from = extrinsic.extrinsic.signer;
            await ensureAccounts([from.toString(), to.toString()]);

            const transferInfo = processDataFail({ currencyId: JSON.parse(JSON.stringify(currencyId)), extrinsic, amount, from, to })
            await transferInfo.save();
        }
    }
}


function processDataSuccess({ currencyId, event, amount, from, to }: MetadataEvent) {
    const { ACALA: {
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

function processDataFail({ currencyId, extrinsic, amount, from, to }: MetadataExtrinsic) {
    const { ACALA: {
        name, decimals
    } } = tokens
    const currency = currencyId ? currencyId.token : name
    const blockNo = extrinsic.block.block.header.number.toNumber();
    const expendedDecimals = BigInt("1" + "0".repeat(decimals))
    const transformedAmount = (amount as Balance).toBigInt();
    const extrinsicHash = extrinsic?.extrinsic.hash.toString();
    const timestamp = extrinsic.block.timestamp;
    const transferInfo = new Transfer(`${blockNo}-${extrinsic.idx}`);
    const isSuccess = false

    transferInfo.token = currency;
    transferInfo.fromId = from.toString();
    transferInfo.toId = to.toString();
    transferInfo.timestamp = timestamp;
    transferInfo.extrinsicHash = extrinsicHash;
    transferInfo.amount = transformedAmount;
    transferInfo.fees = extrinsic ? calculateFees(extrinsic) : BigInt(0)
    transferInfo.status = isSuccess;
    transferInfo.decimals = expendedDecimals;
    return transferInfo
}