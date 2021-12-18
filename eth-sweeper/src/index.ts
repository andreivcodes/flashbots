import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction,
  FlashbotsTransactionResponse,
  RelayResponseError,
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet, ethers } from "ethers";
import { checkSimulation, gasPriceToGwei, printTransactions } from "./utils";
import { config } from "dotenv";
config();

require("log-timestamp");

const BLOCKS_IN_FUTURE = 1;

const GWEI = BigNumber.from(10).pow(9);
const PRIORITY_GAS_PRICE = GWEI.mul(50);

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
  const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL;
  const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    walletRelay
  );

  const walletSource = new Wallet(PRIVATE_KEY_SOURCE);

  let signedBundle: string[];
  let bundleTransactions: (
    | FlashbotsBundleTransaction
    | FlashbotsBundleRawTransaction
  )[];

  provider.on("block", async (blockNumber) => {
    const block = await provider.getBlock(blockNumber);

    const gasPrice = PRIORITY_GAS_PRICE.add(block.baseFeePerGas || 0);

    const currentBalance = await provider.getBalance(walletSource.address);

    const sendValue = currentBalance.sub(gasPrice.mul(21000));

    console.log(`=================================`);
    console.log(
      `current balance: ${ethers.utils.formatEther(currentBalance)} ETH`
    );
    console.log(
      `current gas: ${gasPriceToGwei(block.baseFeePerGas as BigNumber)} gwei`
    );
    console.log(`current gas + bribe: ${gasPriceToGwei(gasPrice)} gwei`);
    console.log(
      `current gas cost: ${gasPriceToGwei(gasPrice.mul(21000))} gwei`
    );
    console.log(
      `expected sent value: ${ethers.utils.formatEther(sendValue)} ETH`
    );

    if (sendValue > BigNumber.from(0)) {
      bundleTransactions = [
        {
          transaction: {
            to: PUBLIC_KEY_DESTINATION,
            gasPrice: gasPrice,
            value: sendValue,
            gasLimit: 21000,
          },
          signer: walletSource,
        },
      ];
      signedBundle = await flashbotsProvider.signBundle(bundleTransactions);

      await printTransactions(bundleTransactions, signedBundle);

      const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;

      const bundleResponse = await flashbotsProvider.sendBundle(
        bundleTransactions,
        targetBlockNumber
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
      } else if (
        bundleResolution ===
        FlashbotsBundleResolution.BlockPassedWithoutInclusion
      ) {
        console.log(`Not included in ${targetBlockNumber}`);
      }
    }
  });
}

ethsweeper();
