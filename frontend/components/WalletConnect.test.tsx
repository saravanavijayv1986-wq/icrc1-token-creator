import { expect, test, describe, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WalletConnect from "./WalletConnect";
import { useWallet } from "../hooks/useWallet";
import { useBackend } from "../hooks/useBackend";

// Mock the hooks
vi.mock("../hooks/useWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("../hooks/useBackend", () => ({
  useBackend: vi.fn(),
}));

// Mock the toast
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("WalletConnect Component", () => {
  let mockConnect: any;
  let mockDisconnect: any;
  let mockTransferICP: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConnect = vi.fn();
    mockDisconnect = vi.fn();
    mockTransferICP = vi.fn();

    // Mock backend
    vi.mocked(useBackend).mockReturnValue({
      transferICP: mockTransferICP,
    } as any);
  });

  test("should show connect button when not connected", () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: false,
      principal: null,
      delegationIdentity: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
    expect(screen.queryByText(/Connected:/)).not.toBeInTheDocument();
  });

  test("should show connected state when wallet is connected", () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    expect(screen.getByText(/Connected:/)).toBeInTheDocument();
    expect(screen.getByText(/test-principal/)).toBeInTheDocument();
    expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument();
  });

  test("should open wallet selection dialog when connect button is clicked", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: false,
      principal: null,
      delegationIdentity: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    fireEvent.click(screen.getByText("Connect Wallet"));

    await waitFor(() => {
      expect(screen.getByText("Connect to Internet Computer")).toBeInTheDocument();
      expect(screen.getByText("Internet Identity")).toBeInTheDocument();
      expect(screen.getByText("NFID")).toBeInTheDocument();
    });
  });

  test("should call connect function when wallet option is selected", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: false,
      principal: null,
      delegationIdentity: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    mockConnect.mockResolvedValue(undefined);

    render(<WalletConnect />);

    fireEvent.click(screen.getByText("Connect Wallet"));

    await waitFor(() => {
      expect(screen.getByText("Internet Identity")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Internet Identity"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith("internet-identity");
    });
  });

  test("should show loading state during connection", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: false,
      principal: null,
      delegationIdentity: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    // Mock slow connection
    mockConnect.mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 100))
    );

    render(<WalletConnect />);

    fireEvent.click(screen.getByText("Connect Wallet"));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Internet Identity"));
    });

    // Should show loading state
    expect(screen.getByText("Internet Identity")).toBeInTheDocument();
  });

  test("should show dropdown menu when connected", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    // Click on the connected button to open dropdown
    fireEvent.click(screen.getByText(/Connected:/));

    await waitFor(() => {
      expect(screen.getByText("Transfer ICP")).toBeInTheDocument();
      expect(screen.getByText("Disconnect")).toBeInTheDocument();
    });
  });

  test("should copy principal to clipboard", async () => {
    const mockWriteText = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    // Open dropdown
    fireEvent.click(screen.getByText(/Connected:/));

    await waitFor(() => {
      const copyButton = screen.getByTitle("Copy principal");
      fireEvent.click(copyButton);
    });

    expect(mockWriteText).toHaveBeenCalledWith("test-principal-1234567890");
  });

  test("should disconnect wallet", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    mockDisconnect.mockResolvedValue(undefined);

    render(<WalletConnect />);

    // Open dropdown
    fireEvent.click(screen.getByText(/Connected:/));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Disconnect"));
    });

    expect(mockDisconnect).toHaveBeenCalled();
  });

  test("should open transfer ICP dialog", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    // Open dropdown
    fireEvent.click(screen.getByText(/Connected:/));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Transfer ICP"));
    });

    await waitFor(() => {
      expect(screen.getByText("Transfer ICP")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("rrkah-fqaaa-aaaah-qcuea-cai")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("0.1")).toBeInTheDocument();
    });
  });

  test("should validate transfer ICP form", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    // Open transfer dialog
    fireEvent.click(screen.getByText(/Connected:/));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText("Transfer ICP"));
    });

    await waitFor(() => {
      // Try to transfer without filling form
      fireEvent.click(screen.getByText("Transfer"));
    });

    // Should not call transfer function
    expect(mockTransferICP).not.toHaveBeenCalled();
  });

  test("should perform ICP transfer", async () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    mockTransferICP.mockResolvedValue({
      success: true,
      transactionId: "test-tx-123",
      blockIndex: "test-block-456",
    });

    render(<WalletConnect />);

    // Open transfer dialog
    fireEvent.click(screen.getByText(/Connected:/));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText("Transfer ICP"));
    });

    await waitFor(() => {
      // Fill form
      fireEvent.change(screen.getByPlaceholderText("rrkah-fqaaa-aaaah-qcuea-cai"), {
        target: { value: "rrkah-fqaaa-aaaah-qcuea-cai" },
      });
      fireEvent.change(screen.getByPlaceholderText("0.1"), {
        target: { value: "1.5" },
      });

      // Submit transfer
      fireEvent.click(screen.getByText("Transfer"));
    });

    await waitFor(() => {
      expect(mockTransferICP).toHaveBeenCalledWith("1.5", "rrkah-fqaaa-aaaah-qcuea-cai");
    });
  });

  test("should show authentication status", () => {
    // Test with valid delegation
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    const { rerender } = render(<WalletConnect />);

    fireEvent.click(screen.getByText(/Connected:/));

    expect(screen.getByText("Authenticated")).toBeInTheDocument();

    // Test without delegation
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "test-principal-1234567890",
      delegationIdentity: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    rerender(<WalletConnect />);

    fireEvent.click(screen.getByText(/Connected:/));

    expect(screen.getByText("Not authenticated")).toBeInTheDocument();
  });

  test("should truncate long principal correctly", () => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      principal: "very-long-principal-identifier-1234567890",
      delegationIdentity: { test: "delegation" },
      connect: mockConnect,
      disconnect: mockDisconnect,
    } as any);

    render(<WalletConnect />);

    // Should show truncated version in button
    expect(screen.getByText(/very-long-p/)).toBeInTheDocument();
    expect(screen.queryByText("very-long-principal-identifier-1234567890")).not.toBeInTheDocument();
  });
});
