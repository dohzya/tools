class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.21.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.1/wl-darwin-arm64"
      sha256 "320ffe526186f90545c26ff0669fc9dd57efc03e2bc61d3ab8bcac4fdd4e1c86"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.1/wl-darwin-x86_64"
      sha256 "603e746f19ec5f346787d3727e942bdd3670666cc4d8330fa27ddf2944b89af6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.1/wl-linux-arm64"
      sha256 "1d3ddd6808dfd18837cbc994413e0dc03f0639509cc4d6ba3bd04fb10f2b8b96"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.1/wl-linux-x86_64"
      sha256 "3e00355e6ff1c1954ea3a86577a4f3da7ce8f5c2347f4f544039bb77188193e8"
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
