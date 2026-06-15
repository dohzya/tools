class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.18.3"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.3/wl-darwin-arm64"
      sha256 "3012e35600d9251f54fa69561da9fb1474465ffb8673554d9a17f2e322b9d47e"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.3/wl-darwin-x86_64"
      sha256 "2aded37a1f7f2044377211ddcfa706c7953eef86f2cd0370033b8abb46aec95c"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.3/wl-linux-arm64"
      sha256 "e2e8e8042a7ec90ec345f7c26ab12df528d248d15e24492e35a8c287960ec1fa"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.3/wl-linux-x86_64"
      sha256 "df727c2b6a24468c905798c9037e8d6b4739d3609923d42fb63c60b8fb9f8665"
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
