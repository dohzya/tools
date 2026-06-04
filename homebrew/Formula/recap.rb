class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.3.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.2/recap-darwin-arm64"
      sha256 "46840d4f88014af6ef059f6b3c43237267bb14e6e656bf4f198bfdf4174b8524"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.2/recap-darwin-x86_64"
      sha256 "287a8a0ad4c85df5c5ca996ebdbe3fad603d670e44393db41520bcfc352fc92e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.2/recap-linux-arm64"
      sha256 "4d9ce20ad8a28a446f62603e9b9e5342fe16017105d2c8009a93855ddeca25cd"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.2/recap-linux-x86_64"
      sha256 "3d5d3944d3d029c250d3534f61cca2943eca06af0c3f481347475d3348b5022c"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
