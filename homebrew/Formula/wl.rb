class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.4.4"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.4/wl-darwin-arm64"
      sha256 "c3e3fb67145b7e0db2ae494da82245f0aa8ad071b91b754ba99d1f44197a6f66"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.4/wl-darwin-x86_64"
      sha256 "8bd0077c969a0663f5da8631adcd82c997c865848ca4b0f81d384753910b28bf"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.4/wl-linux-arm64"
      sha256 "ffa808bc4228216053b358c4d611c16ae811fb92347dc20b81e935672068a729"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.4/wl-linux-x86_64"
      sha256 "c466517006975ba4c981fa506c87bf4cd6414e07e68b503688fd2745c798e940"
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
