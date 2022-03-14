import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Account } from '../types/models/Account';
import { tokens } from '../helpers/token'

async function ensureAccounts(accountIds: string[]): Promise<void> {
    for (const accountId of accountIds) {
        const account = await Account.get(accountId);
        if (!account) {
            await new Account(accountId).save();
        }
    }
}


export async function handleTransfer(event: SubstrateEvent): Promise<void> {
    const { SHIDEN: {
        name, decimals
    } } = tokens
    const {
        event: {
            data: [from, to, amount],
        },
    } = event;
    const blockNo = event.block.block.header.number.toNumber();
    const expendedDecimals = BigInt("1" + "0".repeat(decimals))
    const transformedAmount = (amount as Balance).toBigInt();
    const extrinsicHash = event.extrinsic?.extrinsic.hash.toString();
    const timestamp = event.block.timestamp;
    const transferInfo = new Transfer(`${blockNo}-${event.idx}`);
    const isSuccess = event.extrinsic ? event.extrinsic.success : true;

    await ensureAccounts([from.toString(), to.toString()]);

    transferInfo.token = name;
    transferInfo.fromId = from.toString();
    transferInfo.toId = to.toString();
    transferInfo.timestamp = timestamp;
    transferInfo.extrinsicHash = extrinsicHash;
    transferInfo.amount = transformedAmount;
    transferInfo.status = isSuccess;
    transferInfo.decimals = expendedDecimals;

    await transferInfo.save();
}
