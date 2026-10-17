// scripts/storekit/ArmTests.swift
// Hosted XCTest (TEST_HOST = the app): runs SKTestSession inside the app process, which arms the
// simulator's StoreKit test environment for the app's bundle id. Verified on Xcode 26.6 with an
// iOS 26.5 simulator. Added only to throwaway harness builds by add-harness.rb; never shipped.
import XCTest
import StoreKitTest

final class ArmTests: XCTestCase {
  func testArmDefault() throws {
    let s = try SKTestSession(configurationFileNamed: "Premium")
    s.disableDialogs = true
    s.clearTransactions()
    s.askToBuyEnabled = false
    s.failTransactionsEnabled = false
    // failTransactionsEnabled = false alone did not leave fail mode: reset, then clear again.
    s.resetToDefaultState()
    s.disableDialogs = true
    s.clearTransactions()
    print("STOREKIT ARM default fail=\(s.failTransactionsEnabled) ask=\(s.askToBuyEnabled)")
  }

  func testArmAskToBuy() throws {
    let s = try SKTestSession(configurationFileNamed: "Premium")
    s.disableDialogs = true
    s.clearTransactions()
    s.askToBuyEnabled = true
    print("STOREKIT ARM asktobuy")
  }

  func testArmFail() throws {
    let s = try SKTestSession(configurationFileNamed: "Premium")
    s.disableDialogs = true
    s.clearTransactions()
    // Deprecated since iOS 17 (simulatedError(forAPI:)), still honoured on iOS 26.5.
    s.failTransactionsEnabled = true
    print("STOREKIT ARM fail")
  }

  func testApproveAll() throws {
    let s = try SKTestSession(configurationFileNamed: "Premium")
    let txs = s.allTransactions()
    print("STOREKIT APPROVE txs=\(txs.map { "\($0.identifier) pending=\($0.pendingAskToBuyConfirmation)" })")
    for t in txs where t.pendingAskToBuyConfirmation {
      try s.approveAskToBuyTransaction(identifier: t.identifier)
    }
    s.askToBuyEnabled = false
  }

  func testRefundAll() throws {
    let s = try SKTestSession(configurationFileNamed: "Premium")
    let txs = s.allTransactions()
    print("STOREKIT REFUND txs=\(txs.map { "\($0.identifier)" })")
    for t in txs { try s.refundTransaction(identifier: t.identifier) }
  }
}
