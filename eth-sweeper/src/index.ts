import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction,
  FlashbotsTransactionResponse,
  RelayResponseError,
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet, ethers } from "ethers";
import { gasPriceToGwei, printTransactions } from "./utils";
import { config } from "dotenv";
config();

require("log-timestamp");

const BLOCKS_IN_FUTURE = 1;
const BRIBE = 30;

const GWEI = BigNumber.from(10).pow(9);
let PRIORITY_GAS_PRICE = GWEI.mul(BRIBE);

const PRIVATE_KEY_SOURCE = process.env.PRIVATE_KEY_SOURCE || "";
const PUBLIC_KEY_DESTINATION = process.env.PUBLIC_KEY_DESTINATION || "";
const FLASHBOTS_RELAY_SIGNING_KEY =
  process.env.FLASHBOTS_RELAY_SIGNING_KEY || "";

if (PRIVATE_KEY_SOURCE === "") {
  console.warn(
    "Must provide PRIVATE_KEY_SOURCE environment variable, corresponding to Ethereum EOA with assets to be transferred"
  );
  process.exit(1);
}
if (PUBLIC_KEY_DESTINATION === "") {
  console.warn(
    "Must provide PUBLIC_KEY_DESTINATION environment variable, an address which will receive assets"
  );
  process.exit(1);
}
if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
  console.warn(
    "Must provide FLASHBOTS_RELAY_SIGNING_KEY environment variable. Please see https://github.com/flashbots/pm/blob/main/guides/flashbots-alpha.md"
  );
  process.exit(1);
}

async function ethsweeper() {
  const walletRelay = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);
  const FLASHBOTS_RPC_URL = process.env.FLASHBOTS_RPC_URL;
  const INFURA_RPC_URL = process.env.INFURA_RPC_URL;
  const providerInfura = new providers.StaticJsonRpcProvider(INFURA_RPC_URL);
  const providerFlashbots = new providers.StaticJsonRpcProvider(
    FLASHBOTS_RPC_URL
  );
  const flashbots = await FlashbotsBundleProvider.create(
    providerFlashbots,
    walletRelay
  );

  const walletSource = new Wallet(PRIVATE_KEY_SOURCE);

  let signedBundle: string[];
  let bundleTransactions: (
    | FlashbotsBundleTransaction
    | FlashbotsBundleRawTransaction
  )[];

  providerInfura.on("block", async (blockNumber) => {
    const block = await providerInfura.getBlock("latest");
    const chain = await (await providerInfura.getNetwork()).chainId;

    const maxBaseFeeInFutureBlock =
      FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
        block.baseFeePerGas as BigNumber,
        1
      );

    const priorityFee = PRIORITY_GAS_PRICE;

    const currentBalance = await providerInfura.getBalance(
      walletSource.address
    );

    const gasUsed = 42000;

    const gasEstimateTotal = priorityFee
      .add(maxBaseFeeInFutureBlock)
      .mul(gasUsed);

    const sendValue = currentBalance.sub(gasEstimateTotal);

    console.log(`=====${blockNumber} on chainid ${chain}=====`);
    console.log(
      `current balance: ${ethers.utils.formatEther(currentBalance)} ETH`
    );
    console.log(
      `base gas: ${gasPriceToGwei(block.baseFeePerGas as BigNumber)} gwei`
    );
    console.log(
      `base gas + bribe: ${gasPriceToGwei(
        priorityFee.add(maxBaseFeeInFutureBlock)
      )} gwei`
    );
    console.log(`gas used: ${gasUsed}`);
    console.log(`current gas cost: ${gasPriceToGwei(gasEstimateTotal)} gwei`);
    console.log(
      `expected sent value: ${ethers.utils.formatEther(sendValue)} ETH`
    );

    if (sendValue > BigNumber.from(0)) {
      bundleTransactions = [
        {
          signer: walletSource,
          transaction: {
            to: PUBLIC_KEY_DESTINATION,
            type: 2,
            maxFeePerGas: priorityFee.add(maxBaseFeeInFutureBlock),
            maxPriorityFeePerGas: priorityFee,
            gasLimit: gasUsed,
            chainId: chain,
            value: sendValue,
          },
        },
      ];
      signedBundle = await flashbots.signBundle(bundleTransactions);

      await printTransactions(bundleTransactions, signedBundle);

      const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;

      await flashbots.simulate(signedBundle, targetBlockNumber);

      const bundleResponse = await flashbots.sendBundle(
        bundleTransactions,
        targetBlockNumber
      );

      console.log(
        `Bundle sent! ${
          (bundleResponse as FlashbotsTransactionResponse).bundleHash
        }`
      );

      if ("error" in bundleResponse) {
        console.log(
          `error ${Error((bundleResponse as RelayResponseError).error.message)}`
        );
      }

      const bundleResolution = await (
        bundleResponse as FlashbotsTransactionResponse
      ).wait();

      if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
        console.log(`Congrats, included in ${targetBlockNumber}`);
        PRIORITY_GAS_PRICE = GWEI.mul(BRIBE);
      } else if (
        bundleResolution ===
        FlashbotsBundleResolution.BlockPassedWithoutInclusion
      ) {
        console.log(`Not included in ${targetBlockNumber}`);

        if (chain != 5)
          //not on goerli testnet
          console.log(
            await flashbots.getBundleStats(
              (bundleResponse as FlashbotsTransactionResponse).bundleHash,
              targetBlockNumber
            )
          );

        //if not included, increase bribe
        PRIORITY_GAS_PRICE = PRIORITY_GAS_PRICE.add(GWEI.mul(10));
      }
    }
  });
}

ethsweeper();
