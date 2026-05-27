class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.16.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.16.0/wl-darwin-arm64"
      sha256 "916a1bf468d97a9d84e57b65cd80e0fdc9723cac441ed0c75fb1e57c350296af"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.16.0/wl-darwin-x86_64"
      sha256 "02df3d6967002b29f12bcf674a61fc400f4aec18c7c6f55e59cc0f3f97e32cea"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.16.0/wl-linux-arm64"
      sha256 "b0098c5f712109cc2c5b0bd7e96f920e8b5d27380d75d369072e66d5c3cdb3a3"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.16.0/wl-linux-x86_64"
      sha256 "6e7d5b1b804a2f7a8429343b8dfff12d7594eb67dcf0544c38223a1fe3b605f8"
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
