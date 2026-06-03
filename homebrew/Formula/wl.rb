class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.18.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.0/wl-darwin-arm64"
      sha256 "32a3ceeada033ba0f199d3b60c3909f6ddf95326dd9216c6f1cf2ee26d6ec3ca"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.0/wl-darwin-x86_64"
      sha256 "ca188e1517b5b4b702972d4628b45bb0c4f6855d9002b86895ad47d6f7f6e06e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.0/wl-linux-arm64"
      sha256 "c7b95d4170c67d0f1a8abd04b4cfe2ef3bcefacd0b59ef193b086d2ce3632ef8"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.0/wl-linux-x86_64"
      sha256 "93c0894066664b7f166ffbd90ff2395c33302a11f9b5c836bd0cb8497117ccd1"
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
