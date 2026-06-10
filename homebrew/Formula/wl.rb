class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.18.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.2/wl-darwin-arm64"
      sha256 "010f4499ee15df87bd1d406798998352556e8b1551be3d454c8bf6914b61cb24"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.2/wl-darwin-x86_64"
      sha256 "0f866e573685dc3454ac74af124a19cafec5f31dbaf3c1aadc6945d2f9a69a26"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.2/wl-linux-arm64"
      sha256 "f69346218374c0fb1e4b2d0be51f3489f5ea231edc6f8f7b3689c5554d33189f"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.2/wl-linux-x86_64"
      sha256 "273e7cfe6d22040cf3a6522f3aad400659d04ed468e383cc10928e5ce14038d8"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "wl-darwin-arm64"
      else
        "wl-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "wl-linux-arm64"
      else
        "wl-linux-x86_64"
      end
    end

    bin.install binary_name => "wl"
  end

  test do
    system "#{bin}/wl", "--help"
  end
end
