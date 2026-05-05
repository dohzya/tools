class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.14.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.0/wl-darwin-arm64"
      sha256 "663e9168b88b35761b92f9820e8b25ca2e46c6d0081f6d39370af575822e485a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.0/wl-darwin-x86_64"
      sha256 "8b89355c3a03263eb4276d485f23bc777569a541992391a36b233fdd9607c4f6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.0/wl-linux-arm64"
      sha256 "65c7a9ef3c64900749531c7b6eedf568074e706436f85a5ac40df853ef63dc92"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.0/wl-linux-x86_64"
      sha256 "142d8802a519871533c812cb9291e689b0a09d1920735d186e0b37a0e71f7882"
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
