import ADDRESSES from '../../helpers/coreAssets.json'
import { BaseAdapter, FetchOptions, IJSON, SimpleAdapter } from "../../adapters/types";
import * as sdk from "@defillama/sdk";

const comptrollerABI = {
    underlying: "address:underlying",
    getAllMarkets: "address[]:getAllMarkets",
    accrueInterest: "event AccrueInterest(uint256 cashPrior,uint256 interestAccumulated,uint256 borrowIndex,uint256 totalBorrows)",
    reservesAdded: "event ReservesAdded(address benefactor,uint256 addAmount,uint256 newTotalReserves)",
    reserveFactor: "uint256:reserveFactorMantissa",
};

const baseUnitroller = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";
const moonbeamUnitroller = "0x8E00D5e02E65A19337Cdba98bbA9F84d4186a180";
const moonriverUnitroller = "0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E";
const optimismUnitroller = "0xCa889f40aae37FFf165BccF69aeF1E82b5C511B9";

async function getFees(market: string, { createBalances, api, getLogs, }: FetchOptions, {
    dailyFees,
    dailyRevenue,
    abis = {},
}: {
    dailyFees?: sdk.Balances,
    dailyRevenue?: sdk.Balances,
    abis?: any
}) {
    if (!dailyFees) dailyFees = createBalances()
    if (!dailyRevenue) dailyRevenue = createBalances()
    const markets = await api.call({ target: market, abi: comptrollerABI.getAllMarkets, })
    const underlyings = await api.multiCall({ calls: markets, abi: comptrollerABI.underlying, permitFailure: true, });
    underlyings.forEach((underlying, index) => {
        if (!underlying) underlyings[index] = ADDRESSES.null
    })
    const reserveFactors = await api.multiCall({ calls: markets, abi: abis.reserveFactor ?? comptrollerABI.reserveFactor, });
    const logs: any[] = (await getLogs({
        targets: markets,
        flatten: false,
        eventAbi: comptrollerABI.accrueInterest,
    })).map((log: any, index: number) => {
        return log.map((i: any) => ({
            ...i,
            interestAccumulated: Number(i.interestAccumulated),
            marketIndex: index,
        }));
    }).flat()

    const reservesAddedLogs: any[] = (await getLogs({
        targets: markets,
        flatten: false,
        eventAbi: comptrollerABI.reservesAdded,
    })).map((log: any, index: number) => {
        return log.map((i: any) => ({
            ...i,
            addAmount: Number(i.addAmount),
            marketIndex: index,
        }));
    }).flat()

    logs.forEach((log: any) => {
        const marketIndex = log.marketIndex;
        const underlying = underlyings[marketIndex]
        dailyFees!.add(underlying, log.interestAccumulated);
        dailyRevenue!.add(underlying, log.interestAccumulated * Number(reserveFactors[marketIndex]) / 1e18);
    })

    reservesAddedLogs.forEach((log: any) => {
        const marketIndex = log.marketIndex;
        const underlying = underlyings[marketIndex]
        dailyRevenue!.add(underlying, log.addAmount / 1e18);
    })

    return { dailyFees, dailyRevenue }
}

function moonwellExport(config: IJSON<string>) {
    const exportObject: BaseAdapter = {}
    Object.entries(config).map(([chain, market]) => {
        exportObject[chain] = {
            fetch: (async (options: FetchOptions) => {
                const { dailyFees, dailyRevenue } = await getFees(market, options, {})
                const dailyHoldersRevenue = dailyRevenue
                const dailySupplySideRevenue = options.createBalances()
                dailySupplySideRevenue.addBalances(dailyFees)
                Object.entries(dailyRevenue.getBalances()).forEach(([token, balance]) => {
                    dailySupplySideRevenue.addTokenVannila(token, Number(balance) * -1)
                })
                return { dailyFees, dailyRevenue, dailyHoldersRevenue, dailySupplySideRevenue }
            }),
            start: 0,
        }
    })
    return { adapter: exportObject, version: 2 } as SimpleAdapter
}

export default moonwellExport({ base: baseUnitroller, moonbeam: moonbeamUnitroller, moonriver: moonriverUnitroller, optimism: optimismUnitroller });