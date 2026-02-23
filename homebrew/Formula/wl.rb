class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.9.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.1/wl-darwin-arm64"
      sha256 "cef5e802a6c315e378a094baed042bf15831c98f472a46497c29315c92171cd0"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.1/wl-darwin-x86_64"
      sha256 "ba48b3974ea20ea2d923415900eb2ee7c1f0d9fd089e9875db65e19ab8d19398"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.1/wl-linux-arm64"
      sha256 "ae388abc5268cdb05dfa0c2693933a3ff6837c7d51088d6ac07efea0788cb91e"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.1/wl-linux-x86_64"
      sha256 "add136d931b1e30f7fe20ef8f51af69cb72bd62073d6f55e35159a60d934d7e6"
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
